// Claude usage fetcher, modeled on CodexBar's Claude OAuth provider:
//   credentials: ~/.claude/.credentials.json, then macOS Keychain "Claude Code-credentials"
//   endpoint:    GET https://api.anthropic.com/api/oauth/usage  (anthropic-beta: oauth-2025-04-20)
// Read-only: never rewrites Claude Code's credentials.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as https from 'https'
import { execFile } from 'child_process'

const KEYCHAIN_SERVICE = 'Claude Code-credentials'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const BETA_HEADER = 'oauth-2025-04-20'
const FALLBACK_CLI_VERSION = '2.1.0'
const DELEGATED_REFRESH_COOLDOWN_MS = 5 * 60 * 1000

export type UsageErrorKind = 'auth' | 'rateLimited' | 'server' | 'network' | 'credentials'

export class UsageError extends Error {
    constructor (
        public kind: UsageErrorKind,
        message: string,
        public retryAfterMs: number | null = null,
    ) {
        super(message)
    }
}

export interface UsageWindow {
    title: string
    percent: number
    resetsAt: Date | null
}

export interface ExtraUsage {
    used: number
    limit: number
    currency: string
}

export interface ClaudeUsage {
    session: UsageWindow | null
    weekly: UsageWindow | null
    windows: UsageWindow[]
    extra: ExtraUsage | null
    fetchedAt: Date
    plan: string | null
    credentialSource: string
}

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

/**
 * Run a `claude ...` command. On macOS/Linux it goes through the user's login shell so PATH includes
 * npm/homebrew bins even when Tabby is launched from the desktop; on Windows through cmd.exe.
 */
function runCli (command: string, timeout: number): Promise<{ ok: boolean, stdout: string }> {
    return new Promise(resolve => {
        const done = (err: Error | null, stdout: string): void => resolve({ ok: !err, stdout: stdout || '' })
        if (process.platform === 'win32') {
            execFile(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], { timeout, cwd: os.tmpdir(), windowsHide: true }, done)
        } else {
            const shell = process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
            execFile(shell, ['-lc', command], { timeout, cwd: os.tmpdir() }, done)
        }
    })
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

interface HttpResponse { status: number, headers: Record<string, string | string[] | undefined>, body: string }

function httpGet (url: string, headers: Record<string, string>): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers, timeout: 30000 }, res => {
            let body = ''
            res.setEncoding('utf-8')
            res.on('data', (c: string) => { body += c })
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
        })
        req.on('timeout', () => req.destroy(new Error('Request timed out')))
        req.on('error', e => reject(new UsageError('network', `Network error: ${e.message}`)))
    })
}

function retryAfterMs (header: string | string[] | undefined): number | null {
    if (typeof header !== 'string' || !header) {
        return null
    }
    const secs = Number(header)
    if (Number.isFinite(secs)) {
        return secs * 1000
    }
    const date = Date.parse(header)
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function toWindow (w: RawWindow | null | undefined, title: string): UsageWindow | null {
    if (typeof w?.utilization !== 'number') {
        return null
    }
    return { title, percent: w.utilization, resetsAt: w.resets_at ? new Date(w.resets_at) : null }
}

export function normalize (raw: RawUsage): Omit<ClaudeUsage, 'plan' | 'credentialSource'> {
    const session = toWindow(raw.five_hour, 'Session (5h)')
    const weekly = toWindow(raw.seven_day, 'Weekly (all models)')
    const windows = [
        session,
        weekly,
        toWindow(raw.seven_day_sonnet, 'Weekly (Sonnet)'),
        toWindow(raw.seven_day_opus, 'Weekly (Opus)'),
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
        windows.push({ title, percent: limit.percent, resetsAt: limit.resets_at ? new Date(limit.resets_at) : null })
    }

    let extra: ExtraUsage | null = null
    const e = raw.extra_usage
    if (e?.is_enabled && typeof e.used_credits === 'number' && typeof e.monthly_limit === 'number') {
        // OAuth extra usage is reported in cents.
        extra = { used: e.used_credits / 100, limit: e.monthly_limit / 100, currency: e.currency?.trim() || 'USD' }
    }

    return { session, weekly, windows, extra, fetchedAt: new Date() }
}

export async function fetchUsage (): Promise<ClaudeUsage> {
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
        return { ...normalize(raw), plan: creds.subscriptionType, credentialSource: creds.source }
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
