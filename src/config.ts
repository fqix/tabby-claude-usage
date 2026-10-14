import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'

/** Stored under `claudeUsage` in Tabby's config.yaml. */
export interface ClaudeUsageConfig {
    enabled: boolean
    /** Minutes between automatic refreshes. */
    refreshInterval: number
    align: 'left' | 'right'
    showBrand: boolean
    showSession: boolean
    showWeekly: boolean
    /** The tightest model-scoped weekly limit (e.g. Sonnet / Opus / Fable). */
    showModelWeekly: boolean
    showExtraUsage: boolean
    showMeters: boolean
    showResetTime: boolean
    showLastUpdated: boolean
    warnThreshold: number
    criticalThreshold: number
    /** Custom template; when non-empty it replaces the item toggles. See FORMAT_PLACEHOLDERS. */
    format: string
}

export const DEFAULT_CONFIG: ClaudeUsageConfig = {
    enabled: true,
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
    warnThreshold: 70,
    criticalThreshold: 90,
    format: '',
}

export const FORMAT_PLACEHOLDERS: [string, string][] = [
    ['{session}', 'Session (5h) usage, e.g. 6%'],
    ['{session_reset}', 'Time until the session resets, e.g. 3h23m'],
    ['{weekly}', 'Weekly (all models) usage'],
    ['{weekly_reset}', 'Time until the weekly limit resets'],
    ['{model}', 'Tightest model-scoped weekly usage'],
    ['{model_name}', 'Name of that model, e.g. Sonnet'],
    ['{model_reset}', 'Time until that limit resets'],
    ['{extra}', 'Extra usage spend, e.g. 1.20/50 USD'],
    ['{plan}', 'Subscription plan, e.g. MAX'],
    ['{updated}', 'Time since last refresh'],
]

/** @hidden */
@Injectable()
export class ClaudeUsageConfigProvider extends ConfigProvider {
    defaults = { claudeUsage: DEFAULT_CONFIG }
}
