export type ProviderId = 'claude' | 'codex'

export type UsageErrorKind = 'auth' | 'rateLimited' | 'server' | 'network' | 'credentials' | 'notConfigured'

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
    /** Full title for the details popover, e.g. "Weekly (Sonnet)". */
    title: string
    /** Short label for the status bar, e.g. "7d" or "Sonnet". */
    label: string
    percent: number
    resetsAt: Date | null
}

/** Spend or balance beyond the plan limits (Claude extra usage, Codex credits). */
export interface ExtraInfo {
    /** Popover title, e.g. "Extra usage (month)". */
    title: string
    /** Short status bar label, e.g. "extra". */
    label: string
    /** Display value, e.g. "1.20/50 USD". */
    text: string
    /** Percent of a cap, when there is one. */
    percent: number | null
}

export interface ProviderUsage {
    session: UsageWindow | null
    weekly: UsageWindow | null
    /** All windows, including session and weekly, in display order. */
    windows: UsageWindow[]
    extra: ExtraInfo | null
    plan: string | null
    credentialSource: string
    fetchedAt: Date
}

export interface UsageProvider {
    id: ProviderId
    name: string
    /** Status bar brand, e.g. "✳ Claude". */
    brand: string
    color: string
    fetchUsage (): Promise<ProviderUsage>
}
