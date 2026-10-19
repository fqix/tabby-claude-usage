// Codex provider, modeled on CodexBar's Codex OAuth provider:
//   credentials: $CODEX_HOME/auth.json (default ~/.codex/auth.json), written by the Codex CLI / app
//   endpoint:    GET {chatgpt_base_url}/wham/usage  (default https://chatgpt.com/backend-api)
// Read-only: never refreshes or rewrites auth.json — the Codex CLI owns that file.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { httpGet, retryAfterMs } from './http'
import { ExtraInfo, ProviderUsage, UsageError, UsageProvider, UsageWindow } from './types'

const DEFAULT_BASE_URL = 'https://chatgpt.com/backend-api'

interface Credentials {
    accessToken: string
    accountId: string | null
    expiresAt: number | null
    source: string
}

// Raw response shapes (only the fields we read).
interface RawWindow { used_percent?: number, reset_at?: number | null, limit_window_seconds?: number | null }
interface RawRateLimit { primary_window?: RawWindow | null, secondary_window?: RawWindow | null }
interface RawUsage {
    plan_type?: string | null
    rate_limit?: RawRateLimit | null
    additional_rate_limits?: { limit_name?: string | null, metered_feature?: string | null, rate_limit?: RawRateLimit | null }[] | null
    credits?: { has_credits?: boolean, unlimited?: boolean, balance?: number | string | null } | null
}

function codexHome (): string {
    return process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
}

/** `exp` claim of a JWT access token, in ms. No signature check: the server still authenticates the token. */
export function jwtExpiry (token: string): number | null {
    const payload = token.split('.')[1]
    if (!payload) {
        return null
    }
    try {
        const exp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')).exp
        return Number.isInteger(exp) ? exp * 1000 : null
    } catch {
        return null
    }
}

async function loadCredentials (): Promise<Credentials> {
    const file = path.join(codexHome(), 'auth.json')
    let raw: string
    try {
        raw = await fs.promises.readFile(file, 'utf-8')
    } catch {
        throw new UsageError('notConfigured', `Codex credentials not found (${file}). Log in with \`codex login\`.`)
    }
    let json: any
    try {
        json = JSON.parse(raw)
    } catch {
        throw new UsageError('credentials', `Cannot parse ${file}`)
    }
    const tokens = json?.tokens
    if (!tokens?.access_token) {
        // API-key-only logins have no ChatGPT plan usage to show.
        throw new UsageError('notConfigured', 'Codex is not logged in with ChatGPT. Run `codex login`.')
    }
    return {
        accessToken: tokens.access_token,
        accountId: tokens.account_id ?? null,
        expiresAt: jwtExpiry(tokens.access_token),
        source: file,
    }
}

/** Usage URL, honoring `chatgpt_base_url` in $CODEX_HOME/config.toml like the Codex CLI does. */
async function usageUrl (): Promise<string> {
    let base = DEFAULT_BASE_URL
    try {
        const toml = await fs.promises.readFile(path.join(codexHome(), 'config.toml'), 'utf-8')
        for (const line of toml.split('\n')) {
            const m = /^\s*chatgpt_base_url\s*=\s*["']([^"']+)["']/.exec(line)
            if (m) {
                base = m[1]
                break
            }
        }
    } catch { }
    base = base.replace(/\/+$/, '')
    // Same path rule as Codex's backend client: /backend-api bases use /wham, others /api/codex.
    return base.includes('/backend-api') ? `${base}/wham/usage` : `${base}/api/codex/usage`
}

function windowLabel (seconds: number | null | undefined): string {
    if (!seconds) {
        return ''
    }
    if (seconds === 7 * 24 * 3600) {
        return '7d'
    }
    const hours = seconds / 3600
    return hours >= 24 ? `${Math.round(hours / 24)}d` : `${Math.round(hours)}h`
}

function toWindow (w: RawWindow | null | undefined, title: string, label: string): UsageWindow | null {
    if (typeof w?.used_percent !== 'number') {
        return null
    }
    return { title, label, percent: w.used_percent, resetsAt: w.reset_at ? new Date(w.reset_at * 1000) : null }
}

export function normalizeCodex (raw: RawUsage): Pick<ProviderUsage, 'session' | 'weekly' | 'windows' | 'extra' | 'plan'> {
    const primary = raw.rate_limit?.primary_window
    const secondary = raw.rate_limit?.secondary_window
    const session = toWindow(primary, `Session (${windowLabel(primary?.limit_window_seconds) || '5h'})`, windowLabel(primary?.limit_window_seconds) || '5h')
    const weekly = toWindow(secondary, 'Weekly', windowLabel(secondary?.limit_window_seconds) || '7d')
    const windows = [session, weekly].filter((w): w is UsageWindow => !!w)

    // Model-specific limits (e.g. GPT-5.3-Codex-Spark) come as separate entries.
    const seen = new Set<string>()
    for (const entry of raw.additional_rate_limits ?? []) {
        const name = (entry.limit_name ?? entry.metered_feature ?? '').trim() || 'Codex extra limit'
        for (const w of [entry.rate_limit?.primary_window, entry.rate_limit?.secondary_window]) {
            const span = windowLabel(w?.limit_window_seconds)
            const title = span ? `${name} (${span})` : name
            if (seen.has(title)) {
                continue
            }
            const window = toWindow(w, title, span ? `${name} ${span}` : name)
            if (window) {
                seen.add(title)
                windows.push(window)
            }
        }
    }

    let extra: ExtraInfo | null = null
    const c = raw.credits
    if (c?.has_credits) {
        const balance = Number(c.balance)
        if (c.unlimited) {
            extra = { title: 'Credits', label: 'credits', text: 'unlimited', percent: null }
        } else if (Number.isFinite(balance)) {
            extra = { title: 'Credits balance', label: 'credits', text: Math.floor(balance).toLocaleString('en-US'), percent: null }
        }
    }

    return { session, weekly, windows, extra, plan: raw.plan_type ?? null }
}

async function fetchCodexUsage (): Promise<ProviderUsage> {
    const creds = await loadCredentials()
    if (creds.expiresAt && creds.expiresAt < Date.now()) {
        throw new UsageError('auth', 'Codex login expired. Run `codex` once to refresh it.')
    }
    const headers: Record<string, string> = {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'codex-cli',
    }
    if (creds.accountId) {
        headers['ChatGPT-Account-Id'] = creds.accountId
    }
    const res = await httpGet(await usageUrl(), headers)
    if (res.status === 200) {
        let raw: RawUsage
        try {
            raw = JSON.parse(res.body)
        } catch {
            throw new UsageError('server', 'Invalid JSON from Codex usage endpoint')
        }
        return { ...normalizeCodex(raw), credentialSource: creds.source, fetchedAt: new Date() }
    }
    if (res.status === 401 || res.status === 403) {
        throw new UsageError('auth', 'Codex login is invalid or expired. Run `codex login`.')
    }
    if (res.status === 429) {
        throw new UsageError('rateLimited', 'Codex usage endpoint is rate limited.', retryAfterMs(res.headers['retry-after']))
    }
    throw new UsageError('server', `Codex usage HTTP ${res.status}: ${res.body.slice(0, 200)}`)
}

export const codexProvider: UsageProvider = {
    id: 'codex',
    name: 'Codex',
    brand: '◎ Codex',
    color: '#10a37f',
    fetchUsage: fetchCodexUsage,
}
