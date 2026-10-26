// Webhook notifications for usage events: a user-defined JSON template, filled and POSTed once per event.

import { UsageEvent } from './events'
import { httpRequest } from './providers/http'

export const DEFAULT_TEMPLATE = `{
  "text": "{{text}}",
  "type": "{{type}}",
  "provider": "{{provider}}",
  "window": "{{window}}",
  "percent": "{{percent}}",
  "threshold": "{{threshold}}",
  "resets_at": "{{resets_at}}"
}`

export const TEMPLATE_KEYS: [key: string, description: string][] = [
    ['text', 'Message, e.g. ⚠️ Claude Session (5h) at 92% (≥ 90%)'],
    ['type', 'reset / threshold'],
    ['provider', 'claude / codex'],
    ['provider_name', 'Claude / Codex'],
    ['window', 'Limit name, e.g. Session (5h)'],
    ['kind', 'session / weekly / model'],
    ['label', 'Short name, e.g. 5h / 7d / Sonnet'],
    ['percent', 'Usage now (number)'],
    ['previous_percent', 'Usage before (number)'],
    ['threshold', 'Threshold crossed (number; null for a reset)'],
    ['resets_at', 'Reset time, ISO 8601 (null if unknown)'],
    ['sent_at', 'Send time, ISO 8601'],
]

function templateValues (e: UsageEvent): Record<string, string | number | null> {
    return {
        text: eventMessage(e),
        type: e.type,
        provider: e.provider,
        provider_name: e.providerName,
        window: e.window.title,
        kind: e.kind,
        label: e.window.label,
        percent: Math.round(e.window.percent),
        previous_percent: Math.round(e.previousPercent),
        threshold: e.threshold,
        resets_at: e.window.resetsAt?.toISOString() ?? null,
        sent_at: new Date().toISOString(),
    }
}

/**
 * Fill a JSON template for one event. A placeholder that is a whole string value ("{{percent}}") becomes the raw
 * JSON value (number, string or null); inside other text it is inserted as escaped string content.
 */
export function renderTemplate (template: string, e: UsageEvent): unknown {
    const values = templateValues(e)
    const known = (key: string): boolean => key in values
    const filled = template
        .replace(/"\{\{\s*([a-z_]+)\s*\}\}"/g, (m, key: string) => known(key) ? JSON.stringify(values[key]) : m)
        .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => known(key) ? JSON.stringify(String(values[key] ?? '')).slice(1, -1) : m)
    try {
        return JSON.parse(filled)
    } catch (err: any) {
        throw new Error(`Template is not valid JSON: ${err?.message ?? err}`)
    }
}

/** One line per event, e.g. "⚠️ Claude Weekly (all models) at 92% (≥ 90%), resets 10/27 08:00". */
export function eventMessage (e: UsageEvent): string {
    const name = `${e.providerName} ${e.window.title}`
    if (e.type === 'reset') {
        return `🎉 ${name} reset (was ${Math.round(e.previousPercent)}%)`
    }
    const resets = e.window.resetsAt ? `, resets ${e.window.resetsAt.toLocaleString()}` : ''
    return `⚠️ ${name} at ${Math.round(e.window.percent)}% (≥ ${e.threshold}%)${resets}`
}

/** One request body per event; an empty template falls back to the default. */
export function webhookBodies (events: UsageEvent[], template: string): unknown[] {
    return events.map(e => renderTemplate(template.trim() || DEFAULT_TEMPLATE, e))
}

/** POST the body as JSON. Fails on a non-2xx status, or a 200 carrying an error code (Feishu, DingTalk, WeCom). */
export async function sendWebhook (url: string, body: unknown): Promise<void> {
    if (!/^https?:\/\/\S+$/i.test(url.trim())) {
        throw new Error('Webhook URL must start with http:// or https://')
    }
    const res = await httpRequest('POST', url.trim(), { 'Content-Type': 'application/json' }, JSON.stringify(body))
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`)
    }
    let json: any = null
    try {
        json = JSON.parse(res.body)
    } catch { }
    const code = json?.code ?? json?.errcode ?? json?.StatusCode
    if (typeof code === 'number' && code !== 0) {
        throw new Error(`Rejected (${code}): ${json?.msg ?? json?.errmsg ?? json?.StatusMessage ?? res.body.slice(0, 200)}`)
    }
}
