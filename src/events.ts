// Usage events between two fetches (a limit reset, a threshold crossed), and the state they are detected from.

import { ProviderId, UsageWindow } from './providers/types'

export type WindowSnapshot = Pick<UsageWindow, 'title' | 'percent' | 'resetsAt'>

export type WindowKind = 'session' | 'weekly' | 'model'

/** A user-defined event that triggers a webhook. */
export interface EventRule {
    enabled: boolean
    provider: 'any' | ProviderId
    /** `any` includes model-specific limits. */
    window: 'any' | 'session' | 'weekly'
    /** `reset`: the limit reset; `threshold`: usage went from below `threshold` to at or above it. */
    event: 'reset' | 'threshold'
    threshold: number
}

export const DEFAULT_RULES: EventRule[] = [
    { enabled: true, provider: 'any', window: 'session', event: 'reset', threshold: 90 },
    { enabled: true, provider: 'any', window: 'weekly', event: 'reset', threshold: 90 },
    { enabled: true, provider: 'any', window: 'any', event: 'threshold', threshold: 90 },
]

export interface UsageEvent {
    type: 'reset' | 'threshold'
    provider: ProviderId
    providerName: string
    window: UsageWindow
    kind: WindowKind
    previousPercent: number
    /** The threshold crossed; null for a reset. */
    threshold: number | null
}

/**
 * Windows in `next` that reset since `prev`: usage was at least `minPercent` (and above 0), has dropped,
 * and the window rolled over (its reset time moved later, or one side has no reset time).
 */
export function detectResets (prev: WindowSnapshot[], next: UsageWindow[], minPercent: number): UsageWindow[] {
    return next.filter(w => {
        const old = prev.find(x => x.title === w.title)
        if (!old || old.percent <= 0 || old.percent < minPercent || w.percent >= old.percent) {
            return false
        }
        return !old.resetsAt || !w.resetsAt || w.resetsAt.getTime() > old.resetsAt.getTime()
    })
}

/**
 * Events matching the enabled rules. A window that reset counts once; one that crossed several
 * threshold rules counts once, for the highest threshold.
 */
export function detectEvents (
    provider: { id: ProviderId, name: string },
    prev: WindowSnapshot[],
    next: UsageWindow[],
    kindOf: (w: UsageWindow) => WindowKind,
    rules: EventRule[],
    resetMinPercent: number,
): UsageEvent[] {
    const resets = new Set(detectResets(prev, next, resetMinPercent))
    const events: UsageEvent[] = []
    for (const w of next) {
        const old = prev.find(x => x.title === w.title)
        if (!old) { continue }
        const kind = kindOf(w)
        const matching = rules.filter(r => r.enabled &&
            (r.provider === 'any' || r.provider === provider.id) &&
            (r.window === 'any' || r.window === kind))
        const base = { provider: provider.id, providerName: provider.name, window: w, kind, previousPercent: old.percent }
        if (resets.has(w)) {
            if (matching.some(r => r.event === 'reset')) {
                events.push({ ...base, type: 'reset', threshold: null })
            }
            continue
        }
        const crossed = matching
            .filter(r => r.event === 'threshold' && old.percent < r.threshold && w.percent >= r.threshold)
            .map(r => Number(r.threshold))
        if (crossed.length) {
            events.push({ ...base, type: 'threshold', threshold: Math.max(...crossed) })
        }
    }
    return events
}

// Last seen windows per provider, so a reset that happened while Tabby was closed is still noticed.
const SNAPSHOT_KEY = 'claudeUsage.windows'
// Events already sent, so several Tabby windows (each with its own status bar) send each one once.
const SENT_KEY = 'claudeUsage.sentEvents'
const SENT_TTL_MS = 8 * 24 * 60 * 60 * 1000

function readJson (key: string): Record<string, any> {
    try {
        return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}
    } catch {
        return {}
    }
}

function writeJson (key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch { }
}

export function loadSnapshot (id: ProviderId): WindowSnapshot[] {
    const list = readJson(SNAPSHOT_KEY)[id]
    if (!Array.isArray(list)) { return [] }
    return list.map(w => ({ title: String(w.title), percent: Number(w.percent), resetsAt: w.resetsAt ? new Date(w.resetsAt) : null }))
}

export function saveSnapshot (id: ProviderId, windows: WindowSnapshot[]): void {
    const all = readJson(SNAPSHOT_KEY)
    all[id] = windows.map(({ title, percent, resetsAt }) => ({ title, percent, resetsAt }))
    writeJson(SNAPSHOT_KEY, all)
}

/** Identifies an event within its window period. */
export const eventKey = (e: UsageEvent): string =>
    [e.provider, e.window.title, e.type, e.threshold ?? '', e.window.resetsAt?.toISOString() ?? ''].join('|')

/** The events not yet sent by any Tabby window; they are marked as sent. */
export function claimEvents (events: UsageEvent[]): UsageEvent[] {
    const now = Date.now()
    const sent = readJson(SENT_KEY)
    for (const [k, at] of Object.entries(sent)) {
        if (now - Number(at) > SENT_TTL_MS) {
            delete sent[k]
        }
    }
    const fresh = events.filter(e => !(eventKey(e) in sent))
    for (const e of fresh) {
        sent[eventKey(e)] = now
    }
    writeJson(SENT_KEY, sent)
    return fresh
}
