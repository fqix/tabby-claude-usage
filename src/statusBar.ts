// Bottom status bar for Tabby. Tabby has no status bar API, so this mounts a small DOM bar
// as the last child of <app-root> and shrinks the main window area to make room.

import * as path from 'path'
import { fireworks } from './celebrate'
import { sessionChartSvg } from './chart'
import { ClaudeUsageConfig, DEFAULT_CONFIG, FORMAT_KEYS } from './config'
import { loadSamples, project, recordSample, sessionSeries } from './history'
import { claimEvents, detectEvents, detectResets, loadSnapshot, saveSnapshot, WindowKind, WindowSnapshot } from './events'
import { PROVIDERS, ProviderId, ProviderUsage, UsageError, UsageProvider, UsageWindow } from './providers'
import { sendWebhook, webhookBodies } from './webhook'

const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000
const TICK_MS = 30 * 1000
/** Refresh this long after a window's reset time, so the reset (and its fireworks) shows up promptly. */
const RESET_GRACE_MS = 10 * 1000

const CSS = `
app-root:has(> #claude-usage-bar:not([hidden])) > .window { height: auto !important; flex: 1 1 0; min-height: 0; }
#claude-usage-bar[hidden] { display: none !important; }
#claude-usage-bar {
    flex: none; height: 22px; display: flex; align-items: center; gap: 10px;
    justify-content: flex-end; padding: 0 10px; font-size: 11px; line-height: 22px; white-space: nowrap; overflow: hidden;
    background: var(--theme-bg-more, #1b1b1b); color: var(--theme-fg-less, #aaa);
    border-top: 1px solid rgba(128,128,128,.2); cursor: pointer; user-select: none;
    font-variant-numeric: tabular-nums; position: relative; z-index: 10;
}
#claude-usage-bar.cu-left { justify-content: flex-start; }
#claude-usage-bar:hover { color: var(--theme-fg, #ddd); }
#claude-usage-bar .cu-group { display: inline-flex; align-items: center; gap: 10px; }
#claude-usage-bar .cu-brand { font-weight: 600; }
#claude-usage-bar .cu-switch { cursor: pointer; border-radius: 3px; padding: 0 3px; margin: 0 -3px; }
#claude-usage-bar .cu-switch:hover { background: rgba(128,128,128,.25); }
#claude-usage-bar .cu-item { display: inline-flex; align-items: center; gap: 5px; }
#claude-usage-bar .cu-label { opacity: .7; }
#claude-usage-bar .cu-meter { width: 40px; height: 5px; border-radius: 3px; background: rgba(128,128,128,.25); overflow: hidden; }
#claude-usage-bar .cu-meter > i { display: block; height: 100%; border-radius: 3px; }
#claude-usage-bar .cu-reset { opacity: .55; }
#claude-usage-bar .cu-muted { opacity: .5; }
#claude-usage-bar .cu-err { color: #e5534b; }
#claude-usage-pop {
    position: fixed; right: 8px; bottom: 28px; z-index: 1000; min-width: 280px; max-width: 360px;
    padding: 12px 14px; border-radius: 8px; font-size: 12px;
    background: var(--theme-bg-more, #222); color: var(--theme-fg, #ddd);
    border: 1px solid rgba(128,128,128,.3); box-shadow: 0 8px 24px rgba(0,0,0,.35);
}
#claude-usage-pop.cu-left { left: 8px; right: auto; }
#claude-usage-menu {
    position: fixed; z-index: 1001; min-width: 200px; padding: 4px; border-radius: 8px; font-size: 12px;
    background: var(--theme-bg-more, #222); color: var(--theme-fg, #ddd);
    border: 1px solid rgba(128,128,128,.3); box-shadow: 0 8px 24px rgba(0,0,0,.35);
}
#claude-usage-menu .cu-opt {
    display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 5px; cursor: pointer; white-space: nowrap;
}
#claude-usage-menu .cu-opt:hover { background: rgba(128,128,128,.22); }
#claude-usage-menu .cu-opt .cu-check { width: 12px; opacity: .8; }
#claude-usage-menu .cu-opt .cu-brand { font-weight: 600; }
#claude-usage-menu .cu-opt .cu-sum { margin-left: auto; padding-left: 16px; opacity: .6; font-size: 11px; font-variant-numeric: tabular-nums; }
#claude-usage-pop h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; }
#claude-usage-pop .cu-row { margin: 8px 0; }
#claude-usage-pop .cu-row-head { display: flex; justify-content: space-between; margin-bottom: 3px; }
#claude-usage-pop .cu-big { height: 6px; border-radius: 3px; background: rgba(128,128,128,.25); overflow: hidden; }
#claude-usage-pop .cu-big > i { display: block; height: 100%; border-radius: 3px; }
#claude-usage-pop .cu-sub { opacity: .6; font-size: 11px; }
#claude-usage-pop .cu-chart { display: block; margin-top: 6px; overflow: visible; }
#claude-usage-pop .cu-axis { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; opacity: .6; margin-top: 2px; }
#claude-usage-pop .cu-pace-hot { color: #e5534b; opacity: 1; }
#claude-usage-pop .cu-foot { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
#claude-usage-pop .cu-foot .cu-sub { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#claude-usage-pop .cu-foot button { flex: none; }
#claude-usage-pop button {
    font: inherit; font-size: 11px; padding: 2px 10px; border-radius: 4px; cursor: pointer;
    background: rgba(128,128,128,.2); color: inherit; border: 1px solid rgba(128,128,128,.35);
}
#claude-usage-pop .cu-err { color: #e5534b; white-space: normal; }
`

const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function fmtDuration (ms: number): string {
    if (ms <= 0) { return 'now' }
    const m = Math.round(ms / 60000)
    if (m < 60) { return `${m}m` }
    const h = Math.floor(m / 60)
    if (h < 24) { return `${h}h${String(m % 60).padStart(2, '0')}m` }
    return `${Math.floor(h / 24)}d${h % 24}h`
}

function fmtAgo (date: Date): string {
    const s = Math.round((Date.now() - date.getTime()) / 1000)
    if (s < 60) { return 'just now' }
    return `${fmtDuration(s * 1000)} ago`
}

/** Credential source for the popover: a file shows its name (full path on hover), others (e.g. Keychain) as is. */
function sourceHtml (source: string): string {
    return path.isAbsolute(source)
        ? `<span title="${esc(source)}">${esc(path.basename(source))}</span>`
        : esc(source)
}

const pct = (w: UsageWindow): number => Math.max(0, Math.min(100, Math.round(w.percent)))
const resetIn = (w: UsageWindow | null): string => w?.resetsAt ? fmtDuration(w.resetsAt.getTime() - Date.now()) : ''

interface ProviderState {
    usage: ProviderUsage | null
    error: UsageError | Error | null
    loading: boolean
    lastAttemptAt: number
    backoffUntil: number
}

/** The tightest model-specific window (anything other than session/weekly), if any. */
function modelWindow (u: ProviderUsage): UsageWindow | null {
    return u.windows.filter(w => w !== u.session && w !== u.weekly).sort((a, b) => b.percent - a.percent)[0] ?? null
}

const SHORT_ERRORS: Record<string, string> = {
    auth: 'login expired',
    credentials: 'not logged in',
    rateLimited: 'rate limited',
    network: 'offline',
    server: 'server error',
}

/** Short error label for the status bar; the full message is in the tooltip and the popover. */
const shortError = (e: Error): string => (e instanceof UsageError && SHORT_ERRORS[e.kind]) || 'error'

export class ClaudeUsageBar {
    private states = new Map<ProviderId, ProviderState>(PROVIDERS.map(p => [p.id, {
        usage: null, error: null, loading: false, lastAttemptAt: 0, backoffUntil: 0,
    }]))
    private popOpen = false
    private bar!: HTMLDivElement
    private pop: HTMLDivElement | null = null
    private menu: HTMLDivElement | null = null

    constructor (
        private getConfig: () => Partial<ClaudeUsageConfig> | undefined,
        private setConfig: (patch: Partial<ClaudeUsageConfig>) => void,
    ) { }

    private get cfg (): ClaudeUsageConfig {
        return { ...DEFAULT_CONFIG, ...this.getConfig() }
    }

    private state (p: UsageProvider): ProviderState {
        return this.states.get(p.id)!
    }

    private isEnabled (p: UsageProvider, cfg = this.cfg): boolean {
        return p.id === 'claude' ? cfg.showClaude : cfg.showCodex
    }

    /** Enabled providers worth showing: a provider without credentials is hidden rather than shown as an error. */
    private visibleProviders (cfg = this.cfg): UsageProvider[] {
        return PROVIDERS.filter(p => {
            const err = this.state(p).error
            return this.isEnabled(p, cfg) && !(err instanceof UsageError && err.kind === 'notConfigured')
        })
    }

    /** The single provider shown in the bar: the chosen one, or the first available when it's off / not logged in. */
    private activeProvider (cfg = this.cfg): UsageProvider | null {
        const visible = this.visibleProviders(cfg)
        return visible.find(p => p.id === cfg.barProvider) ?? visible[0] ?? null
    }

    /** Whether there is more than one provider to pick from. */
    private canSwitch (cfg = this.cfg): boolean {
        return this.visibleProviders(cfg).length > 1
    }

    private selectProvider (p: UsageProvider): void {
        this.toggleMenu(false)
        this.setConfig({ barProvider: p.id })
        this.render()
    }

    start (): void {
        const style = document.createElement('style')
        style.id = 'claude-usage-style'
        style.textContent = CSS
        document.head.appendChild(style)

        this.bar = document.createElement('div')
        this.bar.id = 'claude-usage-bar'
        this.bar.addEventListener('click', e => {
            e.stopPropagation()
            if ((e.target as HTMLElement).closest('[data-action="switch"]')) {
                this.toggleMenu()
            } else {
                this.toggleMenu(false)
                this.togglePop()
            }
        })
        document.addEventListener('mousedown', e => {
            const target = e.target as Node
            if (this.popOpen && this.pop && !this.pop.contains(target) && !this.bar.contains(target)) {
                this.togglePop(false)
            }
            if (this.menu && !this.menu.contains(target) && !this.bar.contains(target)) {
                this.toggleMenu(false)
            }
        })
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.menu) {
                this.toggleMenu(false)
            }
        })

        // Wait for <app-root>, then keep the bar as its last child while Angular re-renders it.
        const attach = (): boolean => {
            const root = document.querySelector('app-root')
            if (!root) { return false }
            this.mount()
            new MutationObserver(() => this.mount()).observe(root, { childList: true })
            return true
        }
        if (!attach()) {
            const waitForRoot = new MutationObserver(() => {
                if (attach()) { waitForRoot.disconnect() }
            })
            waitForRoot.observe(document.body, { childList: true, subtree: true })
        }

        this.tick()
        setInterval(() => this.tick(), TICK_MS)
    }

    /** Re-render (and fetch if newly enabled or the interval shrank) after a config change. */
    configChanged (): void {
        if (this.bar) {
            this.tick()
        }
    }

    private tick (): void {
        const cfg = this.cfg
        const intervalMs = Math.max(1, Number(cfg.refreshInterval) || DEFAULT_CONFIG.refreshInterval) * 60 * 1000
        const now = Date.now()
        for (const p of PROVIDERS) {
            const st = this.state(p)
            const resetDue = st.usage?.windows.some(w => {
                const due = w.resetsAt ? w.resetsAt.getTime() + RESET_GRACE_MS : Infinity
                return now >= due && st.lastAttemptAt < due
            })
            if (cfg.enabled && this.isEnabled(p, cfg) && now >= st.backoffUntil && (resetDue || now - st.lastAttemptAt >= intervalMs)) {
                void this.refresh(p)
            }
        }
        this.render()
    }

    private mount (): void {
        const root = document.querySelector('app-root')
        if (root && root.lastElementChild !== this.bar) {
            root.appendChild(this.bar)
        }
    }

    private async refresh (p: UsageProvider): Promise<void> {
        const st = this.state(p)
        if (st.loading) { return }
        st.loading = true
        st.lastAttemptAt = Date.now()
        this.render()
        try {
            const prev = st.usage?.windows ?? loadSnapshot(p.id)
            st.usage = await p.fetchUsage()
            st.error = null
            recordSample(p.id, st.usage.session)
            this.handleEvents(p, prev, st.usage)
        } catch (e: any) {
            st.error = e
            if (e instanceof UsageError && e.kind === 'rateLimited') {
                st.backoffUntil = Date.now() + Math.max(e.retryAfterMs ?? 0, RATE_LIMIT_BACKOFF_MS)
            }
            if (!(e instanceof UsageError && e.kind === 'notConfigured')) {
                console.warn(`[claude-usage] ${p.name}:`, e)
            }
        } finally {
            st.loading = false
            this.render()
        }
    }

    /** Fireworks for limits that reset, and webhooks for events matching the rules, since the last fetch (or session). */
    private handleEvents (p: UsageProvider, prev: WindowSnapshot[], u: ProviderUsage): void {
        saveSnapshot(p.id, u.windows)
        const cfg = this.cfg
        const minPercent = Number(cfg.celebrateMinPercent) || 0

        const resets = detectResets(prev, u.windows, minPercent)
        if (cfg.celebrateResets && resets.length) {
            fireworks(`🎉 ${p.name} ${resets.map(w => w.title).join(', ')} reset`)
        }

        if (!cfg.webhookEnabled || !cfg.webhookUrl.trim()) { return }
        const kindOf = (w: UsageWindow): WindowKind => w === u.session ? 'session' : w === u.weekly ? 'weekly' : 'model'
        const events = detectEvents(p, prev, u.windows, kindOf, cfg.webhookRules ?? [], minPercent)
        const toSend = claimEvents(events)
        if (toSend.length) {
            void (async () => {
                for (const body of webhookBodies(toSend, cfg.webhookTemplate ?? '')) {
                    await sendWebhook(cfg.webhookUrl, body)
                }
            })().catch(e => console.warn('[claude-usage] webhook:', e))
        }
    }

    /** Usage over the current session window, with the projected pace until the reset. */
    private sessionChart (p: UsageProvider, session: UsageWindow): string {
        const series = sessionSeries(loadSamples(p.id), session)
        if (!series) { return '' }
        const cfg = this.cfg
        const now = Date.now()
        const projection = project(series)
        const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        let pace = ''
        if (projection?.hitsLimitAt !== null && projection?.hitsLimitAt !== undefined) {
            pace = `<span class="cu-pace-hot">At this pace: limit in ${fmtDuration(projection.hitsLimitAt - now)}</span>`
        } else if (projection) {
            pace = `<span>At this pace: ~${Math.round(projection.atReset)}% at reset</span>`
        }
        const svg = sessionChartSvg(series, projection, now, {
            color: p.color,
            warnThreshold: Number(cfg.warnThreshold),
            criticalThreshold: Number(cfg.criticalThreshold),
            warnColor: '#d4a72c',
            criticalColor: '#e5534b',
        })
        return `${svg}<div class="cu-axis"><span>${time(series.start)}</span>${pace}<span>${time(series.end)}</span></div>`
    }

    private color (pct: number): string {
        const cfg = this.cfg
        if (pct >= cfg.criticalThreshold) { return '#e5534b' }
        if (pct >= cfg.warnThreshold) { return '#d4a72c' }
        return '#57ab5a'
    }

    private renderItems (u: ProviderUsage, cfg: ClaudeUsageConfig): string[] {
        const item = (w: UsageWindow | null): string => w
            ? `<span class="cu-item"><span class="cu-label">${esc(w.label)}</span>` +
              (cfg.showMeters ? `<span class="cu-meter"><i style="width:${pct(w)}%;background:${this.color(pct(w))}"></i></span>` : '') +
              `<span${cfg.showMeters ? '' : ` style="color:${this.color(pct(w))}"`}>${pct(w)}%</span>` +
              (cfg.showResetTime && w.resetsAt ? `<span class="cu-reset">↻${resetIn(w)}</span>` : '') +
              '</span>'
            : ''
        const parts: string[] = []
        if (cfg.showSession) { parts.push(item(u.session)) }
        if (cfg.showWeekly) { parts.push(item(u.weekly)) }
        const model = modelWindow(u)
        if (cfg.showModelWeekly && model) { parts.push(item(model)) }
        if (cfg.showExtraUsage && u.extra) {
            parts.push(`<span class="cu-item"><span class="cu-label">${esc(u.extra.label)}</span><span>${esc(u.extra.text)}</span></span>`)
        }
        return parts
    }

    /** Fill the user's custom format template; percentages are colored by threshold. */
    private renderFormat (format: string): string {
        const percent = (w: UsageWindow | null): string => w
            ? `<span style="color:${this.color(pct(w))}">${pct(w)}%</span>`
            : '–'
        const values: Record<string, string> = {}
        for (const p of PROVIDERS) {
            const u = this.state(p).usage
            const model = u ? modelWindow(u) : null
            const v: Record<string, string> = {
                session: percent(u?.session ?? null),
                session_reset: esc(resetIn(u?.session ?? null)),
                weekly: percent(u?.weekly ?? null),
                weekly_reset: esc(resetIn(u?.weekly ?? null)),
                model: percent(model),
                model_name: esc(model?.label ?? ''),
                model_reset: esc(resetIn(model)),
                extra: esc(u?.extra?.text ?? ''),
                plan: esc(u?.plan?.toUpperCase() ?? ''),
            }
            for (const [key] of FORMAT_KEYS) {
                values[`${p.id}_${key}`] = v[key]
                if (p.id === 'claude') {
                    values[key] = v[key]
                }
            }
        }
        const fetchedAt = this.activeProvider() && this.state(this.activeProvider()!).usage?.fetchedAt
        values.updated = esc(fetchedAt ? fmtAgo(fetchedAt) : '')
        // Escape literal text between placeholders, substitute known placeholders.
        return format.split(/(\{[a-z_]+\})/).map(part => {
            const key = /^\{([a-z_]+)\}$/.exec(part)?.[1]
            return key && key in values ? values[key] : esc(part)
        }).join('')
    }

    private render (): void {
        if (!this.bar) { return }
        const cfg = this.cfg
        const p = this.activeProvider(cfg)
        this.bar.hidden = !cfg.enabled || !p
        if (!p) {
            this.togglePop(false)
            return
        }
        const left = cfg.align === 'left'
        this.bar.classList.toggle('cu-left', left)

        const st = this.state(p)
        const switchable = this.canSwitch(cfg)
        const main: string[] = []
        if (cfg.format.trim()) {
            main.push(`<span class="cu-item">${this.renderFormat(cfg.format)}</span>`)
        } else {
            // The label opens the provider picker, so it stays visible whenever there is something to pick.
            if (switchable) {
                main.push(`<span class="cu-brand cu-switch" data-action="switch" title="Switch provider" style="color:${p.color}">${esc(p.brand)} ▾</span>`)
            } else if (cfg.showBrand) {
                main.push(`<span class="cu-brand" style="color:${p.color}">${esc(p.brand)}</span>`)
            }
            if (st.usage) {
                main.push(...this.renderItems(st.usage, cfg))
            } else if (!st.error) {
                main.push('<span class="cu-muted">loading…</span>')
            }
            if (st.error) {
                main.push(`<span class="cu-err" title="${esc(st.error.message)}">⚠ ${esc(shortError(st.error))}</span>`)
            }
        }

        let status = ''
        if (st.loading) {
            status = '<span class="cu-muted">refreshing…</span>'
        } else if (st.usage && cfg.showLastUpdated) {
            status = `<span class="cu-muted">${fmtAgo(st.usage.fetchedAt)}</span>`
        }
        // Status text sits on the outer side: after the items when left-aligned, before them when right-aligned.
        this.bar.innerHTML = (left ? [...main, status] : [status, ...main]).join('')
        if (this.popOpen) {
            this.renderPop()
        }
        if (this.menu) {
            if (switchable) {
                this.renderMenu()
            } else {
                this.toggleMenu(false)
            }
        }
    }

    /** One-line summary for the picker, e.g. "5h 22% · 7d 36%" or "⚠ login expired". */
    private summary (p: UsageProvider): string {
        const { usage: u, error } = this.state(p)
        if (error) {
            return `⚠ ${shortError(error)}`
        }
        if (!u) {
            return 'loading…'
        }
        return [u.session, u.weekly].filter((w): w is UsageWindow => !!w).map(w => `${w.label} ${pct(w)}%`).join(' · ')
    }

    private toggleMenu (open = !this.menu): void {
        if (!open) {
            this.menu?.remove()
            this.menu = null
            return
        }
        this.togglePop(false)
        this.menu = document.createElement('div')
        this.menu.id = 'claude-usage-menu'
        this.menu.addEventListener('click', e => {
            const id = (e.target as HTMLElement).closest<HTMLElement>('[data-provider]')?.dataset.provider
            const p = PROVIDERS.find(x => x.id === id)
            if (p) {
                this.selectProvider(p)
            }
        })
        document.body.appendChild(this.menu)
        this.renderMenu()
    }

    private renderMenu (): void {
        if (!this.menu) { return }
        const active = this.activeProvider()
        this.menu.innerHTML = this.visibleProviders().map(p =>
            `<div class="cu-opt" data-provider="${p.id}">` +
            `<span class="cu-check">${p === active ? '✓' : ''}</span>` +
            `<span class="cu-brand" style="color:${p.color}">${esc(p.brand)}</span>` +
            `<span class="cu-sum">${esc(this.summary(p))}</span>` +
            '</div>').join('')
        // Open just above the label, kept inside the window.
        const label = this.bar.querySelector('[data-action="switch"]')
        const rect = (label ?? this.bar).getBoundingClientRect()
        const width = this.menu.offsetWidth
        this.menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`
        this.menu.style.bottom = `${window.innerHeight - rect.top + 4}px`
    }

    private togglePop (open = !this.popOpen): void {
        this.popOpen = open
        if (!open) {
            this.pop?.remove()
            this.pop = null
            return
        }
        this.renderPop()
    }

    private renderPop (): void {
        if (!this.pop) {
            this.pop = document.createElement('div')
            this.pop.id = 'claude-usage-pop'
            this.pop.addEventListener('click', e => {
                const { action } = (e.target as HTMLElement).dataset
                const p = this.activeProvider()
                if (action === 'refresh' && p) {
                    void this.refresh(p)
                }
            })
            document.body.appendChild(this.pop)
        }
        this.pop.classList.toggle('cu-left', this.cfg.align === 'left')
        const p = this.activeProvider()
        if (!p) {
            return
        }
        const { usage: u, error, loading } = this.state(p)
        const rows: string[] = []
        rows.push(`<h4><span style="color:${p.color}">${esc(p.name)} usage</span><span class="cu-sub">${esc(u?.plan ? u.plan.toUpperCase() : '')}</span></h4>`)
        for (const w of u?.windows ?? []) {
            const v = pct(w)
            rows.push(`<div class="cu-row"><div class="cu-row-head"><span>${esc(w.title)}</span><span>${v}% used</span></div>` +
                `<div class="cu-big"><i style="width:${v}%;background:${this.color(v)}"></i></div>` +
                (w.resetsAt ? `<div class="cu-sub">Resets in ${resetIn(w)} · ${esc(w.resetsAt.toLocaleString())}</div>` : '') +
                (w === u?.session && this.cfg.showSessionChart ? this.sessionChart(p, w) : '') +
                '</div>')
        }
        if (u?.extra) {
            const x = u.extra
            rows.push(`<div class="cu-row"><div class="cu-row-head"><span>${esc(x.title)}</span><span>${esc(x.text)}</span></div>` +
                (x.percent !== null ? `<div class="cu-big"><i style="width:${Math.min(x.percent, 100)}%;background:${this.color(x.percent)}"></i></div>` : '') +
                '</div>')
        }
        if (error) {
            rows.push(`<div class="cu-row cu-err">${esc(error.message)}</div>`)
        }
        const status = loading ? 'Refreshing…' : u ? `Updated ${fmtAgo(u.fetchedAt)} · ${sourceHtml(u.credentialSource)}` : ''
        rows.push(`<div class="cu-foot"><span class="cu-sub">${status}</span><button data-action="refresh">Refresh</button></div>`)
        this.pop.innerHTML = rows.join('')
    }
}
