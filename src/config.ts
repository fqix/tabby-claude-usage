import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { ProviderId } from './providers/types'
import { DEFAULT_RULES, EventRule } from './events'
import { DEFAULT_TEMPLATE } from './webhook'

/** Stored under `claudeUsage` in Tabby's config.yaml. */
export interface ClaudeUsageConfig {
    enabled: boolean
    showClaude: boolean
    /** Hidden automatically when ~/.codex/auth.json has no ChatGPT login. */
    showCodex: boolean
    /** The one provider the status bar shows; switched by clicking its label in the bar. */
    barProvider: ProviderId
    /** Minutes between automatic refreshes. */
    refreshInterval: number
    align: 'left' | 'right'
    showBrand: boolean
    showSession: boolean
    showWeekly: boolean
    /** The tightest model-specific limit (Claude: Sonnet / Opus; Codex: e.g. Spark). */
    showModelWeekly: boolean
    showExtraUsage: boolean
    showMeters: boolean
    showResetTime: boolean
    showLastUpdated: boolean
    /** Session usage chart in the details popover. */
    showSessionChart: boolean
    warnThreshold: number
    criticalThreshold: number
    /** Fireworks when a usage limit resets. */
    celebrateResets: boolean
    /** A reset counts (for fireworks and webhooks) only when usage had reached this percent. */
    celebrateMinPercent: number
    webhookEnabled: boolean
    webhookUrl: string
    /** JSON request body sent for each event, with {{placeholders}} (see TEMPLATE_KEYS). */
    webhookTemplate: string
    /** Which events send a webhook. */
    webhookRules: EventRule[]
    /** Use `format` instead of the item toggles. */
    useCustomFormat: boolean
    /** Custom template; when enabled and non-empty it replaces the item toggles. See FORMAT_PLACEHOLDERS. */
    format: string
}

export const DEFAULT_CONFIG: ClaudeUsageConfig = {
    enabled: true,
    showClaude: true,
    showCodex: true,
    barProvider: 'claude',
    refreshInterval: 5,
    align: 'right',
    showBrand: true,
    showSession: true,
    showWeekly: true,
    showModelWeekly: true,
    showExtraUsage: true,
    showMeters: true,
    showResetTime: true,
    showLastUpdated: true,
    showSessionChart: true,
    warnThreshold: 70,
    criticalThreshold: 90,
    celebrateResets: true,
    celebrateMinPercent: 50,
    webhookEnabled: false,
    webhookUrl: '',
    webhookTemplate: DEFAULT_TEMPLATE,
    webhookRules: DEFAULT_RULES,
    useCustomFormat: false,
    format: '',
}

/** Placeholder keys per provider; `{session}` etc. without a prefix refer to Claude. */
export const FORMAT_KEYS: [key: string, description: string][] = [
    ['session', 'Session (5h) usage, e.g. 6%'],
    ['session_reset', 'Time until the session resets, e.g. 3h23m'],
    ['weekly', 'Weekly usage'],
    ['weekly_reset', 'Time until the weekly limit resets'],
    ['model', 'Tightest model-specific limit usage'],
    ['model_name', 'Name of that limit, e.g. Sonnet'],
    ['model_reset', 'Time until that limit resets'],
    ['extra', 'extra usage spend (Codex: credits balance)'],
    ['plan', 'Subscription plan, e.g. MAX / PLUS'],
]

export const FORMAT_PLACEHOLDERS: [string, string][] = [
    ...FORMAT_KEYS.map(([k, d]): [string, string] => [`{${k}}`, `Claude: ${d}`]),
    ['{codex_session}, {codex_weekly}, …', 'Same keys with a codex_ prefix for Codex'],
    ['{claude_session}, …', 'Explicit claude_ prefix also works'],
    ['{updated}', 'Time since last refresh'],
]

/** @hidden */
@Injectable()
export class ClaudeUsageConfigProvider extends ConfigProvider {
    defaults = { claudeUsage: DEFAULT_CONFIG }
}
