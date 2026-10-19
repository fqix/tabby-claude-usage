// Claude provider, modeled on CodexBar's Claude OAuth provider:
//   credentials: ~/.claude/.credentials.json, then macOS Keychain "Claude Code-credentials"
//   endpoint:    GET https://api.anthropic.com/api/oauth/usage  (anthropic-beta: oauth-2025-04-20)
// Read-only: never rewrites Claude Code's credentials.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { httpGet, retryAfterMs, runCli } from './http'
import { ExtraInfo, ProviderUsage, UsageError, UsageProvider, UsageWindow } from './types'

const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const BETA_HEADER = 'oauth-2025-04-20'
const FALLBACK_CLI_VERSION = '2.1.0'
const DELEGATED_REFRESH_COOLDOWN_MS = 5 * 60 * 1000

interface Credentials {
    accessToken: string
    expiresAt: number | null
    subscriptionType: string | null
    source: string
}

// Raw response shapes (only the fields we read).
interface RawWindow { utilization?: number, resets_at?: string | null }
interface RawLimit {
    kind?: string
    group?: string
    percent?: number
    resets_at?: string | null
    scope?: { model?: { display_name?: string } }
}
interface RawUsage {
    five_hour?: RawWindow | null
    seven_day?: RawWindow | null
    seven_day_sonnet?: RawWindow | null
    seven_day_opus?: RawWindow | null
    limits?: RawLimit[] | null
    extra_usage?: { is_enabled?: boolean, monthly_limit?: number, used_credits?: number, currency?: string } | null
}

function claudeConfigDir (): string {
    return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
}

const isExpired = (creds: Credentials): boolean => !!creds.expiresAt && creds.expiresAt < Date.now() + 60 * 1000

function parseCredentials (raw: string, source: string): Credentials {
    let json: any
    try {
        json = JSON.parse(raw)
    } catch {
        throw new UsageError('credentials', `Cannot parse Claude credentials from ${source}`)
    }
    const oauth = json?.claudeAiOauth
    if (!oauth?.accessToken) {
        throw new UsageError('credentials', `No claudeAiOauth token in ${source}. Run \`claude\` and log in.`)
    }
    return {
        accessToken: oauth.accessToken,
        expiresAt: oauth.expiresAt ? Number(oauth.expiresAt) : null,
        subscriptionType: oauth.subscriptionType ?? null,
        source,
    }
}

function readKeychain (): Promise<string> {
    return new Promise((resolve, reject) => {
        if (process.platform !== 'darwin') {
            reject(new UsageError('credentials', 'Claude credentials not found (~/.claude/.credentials.json missing).'))
            return
        }
        execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { timeout: 30000 }, (err, stdout) => {
            if (err) {
                reject(new UsageError('credentials', 'Cannot read Claude Code credentials from Keychain. Run `claude` and log in, then allow Keychain access.'))
                return
            }
            resolve(stdout.trim())
        })
    })
}

async function loadCredentials (): Promise<Credentials> {
    const envToken = process.env.CLAUDE_USAGE_OAUTH_TOKEN
    if (envToken) {
        return { accessToken: envToken, expiresAt: null, subscriptionType: null, source: 'env' }
    }
    const file = path.join(claudeConfigDir(), '.credentials.json')
    try {
        const creds = parseCredentials(await fs.promises.readFile(file, 'utf-8'), file)
        // Prefer the file unless it's expired and the Keychain may hold a newer token.
        if (!isExpired(creds) || process.platform !== 'darwin') {
            return creds
        }
    } catch (e) {
        if (e instanceof UsageError && process.platform !== 'darwin') {
            throw e
        }
    }
    return parseCredentials(await readKeychain(), 'Keychain')
}

let cachedCliVersion: string | null = null
async function detectCliVersion (): Promise<string> {
    if (!cachedCliVersion) {
        const { stdout } = await runCli('claude --version', 10000)
        cachedCliVersion = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? FALLBACK_CLI_VERSION
    }
    return cachedCliVersion
}

// Claude Code only refreshes its OAuth token when the CLI runs. `claude -p /status` makes the CLI
// load (and refresh) its credentials without sending a model request. Throttled to once per 5 min.
let lastDelegatedRefresh = 0
async function delegatedRefresh (): Promise<void> {
    if (Date.now() - lastDelegatedRefresh < DELEGATED_REFRESH_COOLDOWN_MS) {
        return
    }
    lastDelegatedRefresh = Date.now()
    await runCli('claude -p /status', 45000)
}

function toWindow (w: RawWindow | null | undefined, title: string, label: string): UsageWindow | null {
    if (typeof w?.utilization !== 'number') {
        return null
    }
    return { title, label, percent: w.utilization, resetsAt: w.resets_at ? new Date(w.resets_at) : null }
}

export function normalizeClaude (raw: RawUsage): Pick<ProviderUsage, 'session' | 'weekly' | 'windows' | 'extra'> {
    const session = toWindow(raw.five_hour, 'Session (5h)', '5h')
    const weekly = toWindow(raw.seven_day, 'Weekly (all models)', '7d')
    const windows = [
        session,
        weekly,
        toWindow(raw.seven_day_sonnet, 'Weekly (Sonnet)', 'Sonnet'),
        toWindow(raw.seven_day_opus, 'Weekly (Opus)', 'Opus'),
    ].filter((w): w is UsageWindow => !!w)

    const seen = new Set(windows.map(w => w.title))
    for (const limit of raw.limits ?? []) {
        if (limit.group !== 'weekly' || limit.kind !== 'weekly_scoped' || typeof limit.percent !== 'number') {
            continue
        }
        const name = limit.scope?.model?.display_name
        if (!name || /^all models$/i.test(name)) {
            continue
        }
        const title = `Weekly (${name})`
        if (seen.has(title)) {
            continue
        }
        seen.add(title)
        windows.push({ title, label: name, percent: limit.percent, resetsAt: limit.resets_at ? new Date(limit.resets_at) : null })
    }

    let extra: ExtraInfo | null = null
    const e = raw.extra_usage
    if (e?.is_enabled && typeof e.used_credits === 'number' && typeof e.monthly_limit === 'number') {
        // OAuth extra usage is reported in cents.
        const used = e.used_credits / 100
        const limit = e.monthly_limit / 100
        const currency = e.currency?.trim() || 'USD'
        extra = {
            title: 'Extra usage (month)',
            label: 'extra',
            text: `${used.toFixed(2)}/${limit.toFixed(0)} ${currency}`,
            percent: limit > 0 ? Math.round(used / limit * 100) : null,
        }
    }

    return { session, weekly, windows, extra }
}

async function fetchClaudeUsage (): Promise<ProviderUsage> {
    let creds = await loadCredentials()
    if (isExpired(creds) && creds.source !== 'env') {
        await delegatedRefresh()
        creds = await loadCredentials()
    }
    if (isExpired(creds)) {
        throw new UsageError('auth', 'Claude OAuth token expired. Run `claude` once to refresh it.')
    }
    const res = await httpGet(USAGE_URL, {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'anthropic-beta': BETA_HEADER,
        'User-Agent': `claude-code/${await detectCliVersion()}`,
    })
    if (res.status === 200) {
        let raw: RawUsage
        try {
            raw = JSON.parse(res.body)
        } catch {
            throw new UsageError('server', 'Invalid JSON from Claude usage endpoint')
        }
        return { ...normalizeClaude(raw), plan: creds.subscriptionType, credentialSource: creds.source, fetchedAt: new Date() }
    }
    if (res.status === 401) {
        throw new UsageError('auth', 'Claude OAuth unauthorized. Run `claude` to re-authenticate.')
    }
    if (res.status === 403 && res.body.includes('user:profile')) {
        throw new UsageError('auth', 'Token lacks the user:profile scope. Log in with `claude` (not `claude setup-token`).')
    }
    if (res.status === 429) {
        throw new UsageError('rateLimited', 'Claude usage endpoint is rate limited.', retryAfterMs(res.headers['retry-after']))
    }
    throw new UsageError('server', `Claude usage HTTP ${res.status}: ${res.body.slice(0, 200)}`)
}

export const claudeProvider: UsageProvider = {
    id: 'claude',
    name: 'Claude',
    brand: '✳ Claude',
    color: '#d97757',
    fetchUsage: fetchClaudeUsage,
}
