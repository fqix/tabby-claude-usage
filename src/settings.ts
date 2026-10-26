import { ChangeDetectorRef, Component, HostBinding, Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { celebrate, EFFECTS } from './celebrate'
import { ClaudeUsageConfig, FORMAT_PLACEHOLDERS } from './config'
import { DEFAULT_RULES, EventRule, UsageEvent } from './events'
import { DEFAULT_TEMPLATE, eventMessage, sendWebhook, TEMPLATE_KEYS, webhookBodies } from './webhook'

type FieldType = 'toggle' | 'number' | 'select' | 'text' | 'textarea'

interface Field {
    key: keyof ClaudeUsageConfig
    type: FieldType
    title: string
    description?: string
    options?: [value: string, label: string][]
    min?: number
    max?: number
    placeholder?: string
    /** Hidden unless this returns true. */
    show?: (cfg: ClaudeUsageConfig) => boolean
    /** Dimmed (still editable) when this returns true. */
    dim?: (cfg: ClaudeUsageConfig) => boolean
    /** A button next to the control, handled by `action()`. */
    action?: { id: 'previewCelebration' | 'testWebhook', label: string }
}

interface Section {
    title: string
    description?: string | ((cfg: ClaudeUsageConfig) => string)
    fields: Field[]
    /** Shown only while the status bar is enabled. */
    needsEnabled?: boolean
    /** Extra content below the fields. */
    extra?: 'placeholders' | 'webhookRules'
}

const usesFormat = (cfg: ClaudeUsageConfig): boolean => cfg.useCustomFormat && !!cfg.format?.trim()

const SECTIONS: Section[] = [
    {
        title: 'General',
        fields: [
            { key: 'enabled', type: 'toggle', title: 'Show status bar', description: 'Claude / Codex subscription usage at the bottom of the window' },
            { key: 'align', type: 'select', title: 'Alignment', options: [['left', 'Left'], ['right', 'Right']], show: c => c.enabled },
            { key: 'refreshInterval', type: 'number', title: 'Refresh interval (minutes)', description: 'The usage endpoint is rate limited; 5 minutes or more is recommended', min: 1, max: 120, show: c => c.enabled },
        ],
    },
    {
        title: 'Providers',
        description: 'The status bar shows one provider at a time — click its label to pick one.',
        needsEnabled: true,
        fields: [
            { key: 'showClaude', type: 'toggle', title: 'Claude', description: 'Reads the Claude Code CLI login (~/.claude or macOS Keychain)' },
            { key: 'showCodex', type: 'toggle', title: 'Codex', description: 'Reads the Codex ChatGPT login (~/.codex/auth.json); skipped when not logged in' },
        ],
    },
    {
        title: 'Thresholds',
        description: 'Usage turns yellow / red at these levels.',
        needsEnabled: true,
        fields: [
            { key: 'warnThreshold', type: 'number', title: 'Warning (%)', min: 0, max: 100 },
            { key: 'criticalThreshold', type: 'number', title: 'Critical (%)', min: 0, max: 100 },
        ],
    },
    {
        title: 'Status bar items',
        description: cfg => usesFormat(cfg) ? 'The custom format below is on, so these toggles are ignored.' : '',
        needsEnabled: true,
        fields: ([
            ['showBrand', 'Provider label', '"✳ Claude" / "◎ Codex"; always shown when it is needed to switch providers'],
            ['showSession', 'Session (5h) limit', ''],
            ['showWeekly', 'Weekly limit', 'All models'],
            ['showModelWeekly', 'Model-specific limit', 'The tightest one, e.g. Sonnet / Opus / Codex Spark'],
            ['showExtraUsage', 'Extra usage / credits', 'Claude extra usage spend, Codex credits balance'],
            ['showMeters', 'Progress meters', ''],
            ['showResetTime', 'Time until reset', ''],
            ['showLastUpdated', 'Last refresh time', ''],
        ] as [keyof ClaudeUsageConfig, string, string][]).map(([key, title, description]): Field => ({
            key, type: 'toggle', title, description, dim: usesFormat,
        })),
    },
    {
        title: 'Details',
        description: 'Shown when you click the status bar.',
        needsEnabled: true,
        fields: [
            { key: 'showSessionChart', type: 'toggle', title: 'Session chart', description: 'Usage over the current 5h window, with the projected pace until the reset' },
        ],
    },
    {
        title: 'Custom format',
        needsEnabled: true,
        fields: [
            { key: 'useCustomFormat', type: 'toggle', title: 'Use custom format', description: 'Replace the items above with your own template' },
            {
                key: 'format', type: 'text', title: 'Format', placeholder: '(default layout)',
                description: 'Example: ✳ {session} · {weekly} │ ◎ {codex_session} · {codex_weekly}',
                show: c => c.useCustomFormat,
            },
        ],
        extra: 'placeholders',
    },
    {
        title: 'Celebration',
        needsEnabled: true,
        fields: [
            {
                key: 'celebrateResets', type: 'toggle', title: 'Celebrate resets', description: 'A full-window effect when a usage limit resets',
            },
            {
                key: 'celebrateEffect', type: 'select', title: 'Effect', options: EFFECTS,
                show: c => c.celebrateResets,
                action: { id: 'previewCelebration', label: 'Preview' },
            },
            {
                key: 'celebrateMinPercent', type: 'number', title: 'Minimum usage before a reset counts (%)',
                description: 'Applies to the celebration and reset webhooks; 0 counts any reset after use', min: 0, max: 100,
            },
        ],
    },
    {
        title: 'Webhook',
        description: 'POST a message when a limit resets or crosses a threshold. Sent once even with several Tabby windows open.',
        needsEnabled: true,
        fields: [
            { key: 'webhookEnabled', type: 'toggle', title: 'Send webhooks' },
            {
                key: 'webhookUrl', type: 'text', title: 'URL', placeholder: 'https://…',
                description: 'Stored in plain text in config.yaml',
                show: c => c.webhookEnabled,
                action: { id: 'testWebhook', label: 'Send test' },
            },
            {
                key: 'webhookTemplate', type: 'textarea', title: 'JSON template',
                description: 'Request body POSTed for each event. "{{key}}" as a whole value becomes a number / string / null; inside other text it is inserted as text.',
                show: c => c.webhookEnabled,
            },
        ],
        extra: 'webhookRules',
    },
]

/** @hidden */
@Component({
    template: `
<h3>AI Usage</h3>

<ng-container *ngFor="let s of sections">
    <ng-container *ngIf="!s.needsEnabled || cfg.enabled">
        <h3 class="mt-4" *ngIf="s.title !== 'General'">{{ s.title }}</h3>
        <div class="section-desc" *ngIf="describe(s)">{{ describe(s) }}</div>

        <ng-container *ngFor="let f of s.fields">
            <div class="form-line" *ngIf="!f.show || f.show(cfg)" [class.dim]="f.dim && f.dim(cfg)">
                <div class="header">
                    <div class="title">{{ f.title }}</div>
                    <div class="description" *ngIf="f.description">{{ f.description }}</div>
                </div>
                <ng-container [ngSwitch]="f.type">
                    <toggle *ngSwitchCase="'toggle'" [(ngModel)]="cfg[f.key]" (ngModelChange)="save()"></toggle>
                    <select *ngSwitchCase="'select'" class="form-control" [(ngModel)]="cfg[f.key]" (ngModelChange)="save()">
                        <option *ngFor="let o of f.options" [value]="o[0]">{{ o[1] }}</option>
                    </select>
                    <input *ngSwitchCase="'number'" class="form-control" type="number" [min]="f.min" [max]="f.max" [(ngModel)]="cfg[f.key]" (ngModelChange)="save()">
                    <input *ngSwitchCase="'text'" class="form-control text-field" type="text" [placeholder]="f.placeholder || ''" [(ngModel)]="cfg[f.key]" (ngModelChange)="save()">
                    <textarea *ngSwitchCase="'textarea'" class="form-control template" rows="8" spellcheck="false" [(ngModel)]="cfg[f.key]" (ngModelChange)="save()"></textarea>
                </ng-container>
                <button *ngIf="f.action" class="btn btn-secondary action" [disabled]="busy" (click)="action(f.action.id)">{{ f.action.label }}</button>
            </div>
        </ng-container>

        <table *ngIf="s.extra === 'placeholders' && cfg.useCustomFormat" class="table table-sm mt-2 placeholders">
            <tr *ngFor="let p of placeholders">
                <td><code>{{ p[0] }}</code></td>
                <td>{{ p[1] }}</td>
            </tr>
        </table>
        <ng-container *ngIf="s.extra === 'webhookRules' && cfg.webhookEnabled">
            <table class="table table-sm mt-2 placeholders">
                <tr *ngFor="let k of templateKeys">
                    <td><code [textContent]="placeholder(k[0])"></code></td>
                    <td>{{ k[1] }}</td>
                </tr>
            </table>
            <button class="btn btn-link px-0" (click)="resetTemplate()">Restore default template</button>
        </ng-container>
        <div *ngIf="s.extra === 'webhookRules' && webhookResult" class="section-desc" [class.text-danger]="webhookFailed">{{ webhookResult }}</div>
        <ng-container *ngIf="s.extra === 'webhookRules' && cfg.webhookEnabled">
            <h5 class="mt-3">Events</h5>
            <div class="section-desc">Send a webhook when any enabled rule matches. Resets count only after the minimum usage set under Celebration.</div>
            <div class="rule" *ngFor="let r of cfg.webhookRules; let i = index">
                <toggle [(ngModel)]="r.enabled" (ngModelChange)="save()" title="Enabled"></toggle>
                <select class="form-control" [(ngModel)]="r.provider" (ngModelChange)="save()">
                    <option *ngFor="let o of ruleProviders" [value]="o[0]">{{ o[1] }}</option>
                </select>
                <select class="form-control" [(ngModel)]="r.window" (ngModelChange)="save()">
                    <option *ngFor="let o of ruleWindows" [value]="o[0]">{{ o[1] }}</option>
                </select>
                <select class="form-control" [(ngModel)]="r.event" (ngModelChange)="save()">
                    <option value="reset">resets</option>
                    <option value="threshold">reaches</option>
                </select>
                <input *ngIf="r.event === 'threshold'" class="form-control pct" type="number" min="1" max="100" [(ngModel)]="r.threshold" (ngModelChange)="save()">
                <span *ngIf="r.event === 'threshold'">%</span>
                <button class="btn btn-secondary btn-sm ms-auto" [disabled]="busy" title="Send a sample message for this event" (click)="testWebhook(r)">Test</button>
                <button class="btn btn-link" title="Remove" (click)="removeRule(i)">✕</button>
            </div>
            <div class="mt-2">
                <button class="btn btn-secondary me-2" (click)="addRule()">Add event</button>
                <button class="btn btn-link" (click)="resetRules()">Restore defaults</button>
            </div>
        </ng-container>
    </ng-container>
</ng-container>
`,
    styles: [`
        .section-desc { opacity: .7; margin: -4px 0 8px; font-size: 12px; }
        .placeholders td { padding: 2px 12px 2px 0; border: none; opacity: .8; }
        .form-line.dim { opacity: .4; }
        /* Nothing sets a minimum width wider than the pane: controls shrink, then wrap onto the next line. */
        :host { overflow-x: hidden; }
        .form-line { flex-wrap: wrap; row-gap: 6px; min-width: 0; }
        .form-line .header { flex: 1 1 160px; min-width: 0; }
        .form-line .action, .rule .btn { flex: none; white-space: nowrap; }
        .form-line .action { margin-left: 12px; }
        .text-field { flex: 1 1 220px; min-width: 0; max-width: 480px; }
        .template { flex: 1 1 100%; min-width: 0; font-family: monospace; font-size: 12px; }
        .placeholders { table-layout: fixed; width: 100%; }
        .placeholders td:first-child { width: 40%; }
        .placeholders td { overflow-wrap: anywhere; }
        .rule { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0; }
        .rule select { width: auto; max-width: 100%; min-width: 0; }
        .rule .pct { width: 80px; }
    `],
})
export class ClaudeUsageSettingsTabComponent {
    sections = SECTIONS
    placeholders = FORMAT_PLACEHOLDERS
    templateKeys = TEMPLATE_KEYS
    busy = false
    ruleProviders = [['any', 'Any provider'], ['claude', 'Claude'], ['codex', 'Codex']]
    ruleWindows = [['any', 'any limit'], ['session', 'Session (5h)'], ['weekly', 'Weekly']]
    webhookResult = ''
    webhookFailed = false

    @HostBinding('class.content-box') contentBox = true

    constructor (public config: ConfigService, private cdr: ChangeDetectorRef) {
        // Until the user edits them, the rules come from the defaults; copy them into the stored config
        // so that editing a rule in place is saved (and never changes DEFAULT_RULES).
        this.cfg.webhookRules = (this.cfg.webhookRules ?? DEFAULT_RULES).map((r: EventRule) => ({ ...r }))
    }

    get cfg (): any {
        return this.config.store.claudeUsage
    }

    describe (s: Section): string {
        return typeof s.description === 'function' ? s.description(this.cfg) : s.description ?? ''
    }

    save (): void {
        void this.config.save()
    }

    addRule (): void {
        const rule: EventRule = { enabled: true, provider: 'any', window: 'session', event: 'threshold', threshold: 80 }
        this.cfg.webhookRules = [...(this.cfg.webhookRules ?? []), rule]
        this.save()
    }

    removeRule (i: number): void {
        this.cfg.webhookRules = this.cfg.webhookRules.filter((_: EventRule, j: number) => j !== i)
        this.save()
    }

    placeholder (key: string): string {
        return `{{${key}}}`
    }

    resetTemplate (): void {
        this.cfg.webhookTemplate = DEFAULT_TEMPLATE
        this.save()
    }

    resetRules (): void {
        this.cfg.webhookRules = DEFAULT_RULES.map(r => ({ ...r }))
        this.save()
    }

    action (id: 'previewCelebration' | 'testWebhook'): void {
        if (id === 'previewCelebration') {
            celebrate(this.cfg.celebrateEffect, '🎉 Session (5h) reset')
        } else {
            void this.testWebhook()
        }
    }

    /** Send a sample message: for one rule, or a generic threshold event. */
    async testWebhook (rule?: EventRule): Promise<void> {
        const cfg = this.cfg as ClaudeUsageConfig
        const r: EventRule = rule ?? { enabled: true, provider: 'claude', window: 'session', event: 'threshold', threshold: 90 }
        const provider = r.provider === 'codex' ? 'codex' : 'claude'
        const windows = { any: ['Session (5h)', '5h'], session: ['Session (5h)', '5h'], weekly: ['Weekly (all models)', '7d'], model: ['Weekly (Sonnet)', 'Sonnet'] }
        const [title, label] = windows[r.window] ?? windows.any
        const threshold = Number(r.threshold) || 90
        const sample: UsageEvent = {
            type: r.event,
            provider,
            providerName: provider === 'codex' ? 'Codex' : 'Claude',
            window: { title, label, percent: r.event === 'reset' ? 0 : threshold, resetsAt: new Date(Date.now() + 2 * 3600 * 1000) },
            kind: r.window === 'any' ? 'session' : r.window,
            previousPercent: r.event === 'reset' ? Math.max(threshold, 80) : Math.max(threshold - 5, 0),
            threshold: r.event === 'reset' ? null : threshold,
        }
        this.busy = true
        this.webhookFailed = false
        this.webhookResult = 'Sending test…'
        try {
            for (const body of webhookBodies([sample], cfg.webhookTemplate ?? '')) {
                await sendWebhook(cfg.webhookUrl ?? '', body)
            }
            this.webhookResult = `Test sent: ${eventMessage(sample)}`
        } catch (e: any) {
            this.webhookFailed = true
            this.webhookResult = `Test failed: ${e?.message ?? e}`
        } finally {
            this.busy = false
            this.cdr.detectChanges()
        }
    }
}

/** @hidden */
@Injectable()
export class ClaudeUsageSettingsTabProvider extends SettingsTabProvider {
    id = 'claude-usage'
    icon = 'chart-bar'
    title = 'AI Usage'

    getComponentType (): any {
        return ClaudeUsageSettingsTabComponent
    }
}
