// Bottom status bar for Tabby. Tabby has no status bar API, so this mounts a small DOM bar
// as the last child of <app-root> and shrinks the main window area to make room.

import { ClaudeUsageConfig, DEFAULT_CONFIG } from './config'
import { ClaudeUsage, UsageError, UsageWindow, fetchUsage } from './usage'

const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000
const TICK_MS = 30 * 1000

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
#claude-usage-bar .cu-brand { color: #d97757; font-weight: 600; }
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
#claude-usage-pop h4 { margin: 0 0 8px; font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; }
#claude-usage-pop .cu-row { margin: 8px 0; }
#claude-usage-pop .cu-row-head { display: flex; justify-content: space-between; margin-bottom: 3px; }
#claude-usage-pop .cu-big { height: 6px; border-radius: 3px; background: rgba(128,128,128,.25); overflow: hidden; }
#claude-usage-pop .cu-big > i { display: block; height: 100%; border-radius: 3px; }
#claude-usage-pop .cu-sub { opacity: .6; font-size: 11px; }
#claude-usage-pop .cu-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
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

const pct = (w: UsageWindow): number => Math.max(0, Math.min(100, Math.round(w.percent)))
const resetIn = (w: UsageWindow | null): string => w?.resetsAt ? fmtDuration(w.resetsAt.getTime() - Date.now()) : ''
const modelName = (w: UsageWindow): string => w.title.replace(/^Weekly \((.*)\)$/, '$1')

export class ClaudeUsageBar {
    private usage: ClaudeUsage | null = null
    private error: UsageError | Error | null = null
    private loading = false
    private lastAttemptAt = 0
    private backoffUntil = 0
    private popOpen = false
    private bar!: HTMLDivElement
    private pop: HTMLDivElement | null = null

    constructor (private getConfig: () => Partial<ClaudeUsageConfig> | undefined) { }

    private get cfg (): ClaudeUsageConfig {
        return { ...DEFAULT_CONFIG, ...this.getConfig() }
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
            this.togglePop()
        })
        document.addEventListener('mousedown', e => {
            const target = e.target as Node
            if (this.popOpen && this.pop && !this.pop.contains(target) && !this.bar.contains(target)) {
                this.togglePop(false)
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
        if (cfg.enabled && now >= this.backoffUntil && now - this.lastAttemptAt >= intervalMs) {
            void this.refresh()
        } else {
            this.render()
        }
    }

    private mount (): void {
        const root = document.querySelector('app-root')
        if (root && root.lastElementChild !== this.bar) {
            root.appendChild(this.bar)
        }
    }

    async refresh (): Promise<void> {
        if (this.loading) { return }
        this.loading = true
        this.lastAttemptAt = Date.now()
        this.render()
        try {
            this.usage = await fetchUsage()
            this.error = null
        } catch (e: any) {
            this.error = e
            if (e instanceof UsageError && e.kind === 'rateLimited') {
                this.backoffUntil = Date.now() + Math.max(e.retryAfterMs ?? 0, RATE_LIMIT_BACKOFF_MS)
            }
            console.warn('[claude-usage]', e)
        } finally {
            this.loading = false
            this.render()
        }
    }

    private color (pct: number): string {
        const cfg = this.cfg
        if (pct >= cfg.criticalThreshold) { return '#e5534b' }
        if (pct >= cfg.warnThreshold) { return '#d4a72c' }
        return '#57ab5a'
    }

    /** The tightest model-scoped weekly window, if any. */
    private modelWindow (u: ClaudeUsage): UsageWindow | null {
        return u.windows.filter(w => w !== u.session && w !== u.weekly).sort((a, b) => b.percent - a.percent)[0] ?? null
    }

    private renderItems (u: ClaudeUsage, cfg: ClaudeUsageConfig): string[] {
        const item = (label: string, w: UsageWindow | null): string => w
            ? `<span class="cu-item"><span class="cu-label">${esc(label)}</span>` +
              (cfg.showMeters ? `<span class="cu-meter"><i style="width:${pct(w)}%;background:${this.color(pct(w))}"></i></span>` : '') +
              `<span${cfg.showMeters ? '' : ` style="color:${this.color(pct(w))}"`}>${pct(w)}%</span>` +
              (cfg.showResetTime && w.resetsAt ? `<span class="cu-reset">↻${resetIn(w)}</span>` : '') +
              '</span>'
            : ''
        const parts: string[] = []
        if (cfg.showSession) { parts.push(item('5h', u.session)) }
        if (cfg.showWeekly) { parts.push(item('7d', u.weekly)) }
        const model = this.modelWindow(u)
        if (cfg.showModelWeekly && model) { parts.push(item(modelName(model), model)) }
        if (cfg.showExtraUsage && u.extra) {
            parts.push(`<span class="cu-item"><span class="cu-label">extra</span><span>${u.extra.used.toFixed(2)}/${u.extra.limit.toFixed(0)} ${esc(u.extra.currency)}</span></span>`)
        }
        return parts
    }

    /** Fill the user's custom format template; percentages are colored by threshold. */
    private renderFormat (u: ClaudeUsage, format: string): string {
        const percent = (w: UsageWindow | null): string => w
            ? `<span style="color:${this.color(pct(w))}">${pct(w)}%</span>`
            : '–'
        const model = this.modelWindow(u)
        const values: Record<string, string> = {
            session: percent(u.session),
            session_reset: esc(resetIn(u.session)),
            weekly: percent(u.weekly),
            weekly_reset: esc(resetIn(u.weekly)),
            model: percent(model),
            model_name: esc(model ? modelName(model) : ''),
            model_reset: esc(resetIn(model)),
            extra: u.extra ? esc(`${u.extra.used.toFixed(2)}/${u.extra.limit.toFixed(0)} ${u.extra.currency}`) : '',
            plan: esc(u.plan?.toUpperCase() ?? ''),
            updated: esc(fmtAgo(u.fetchedAt)),
        }
        // Escape literal text between placeholders, substitute known placeholders.
        return format.split(/(\{[a-z_]+\})/).map(part => {
            const key = /^\{([a-z_]+)\}$/.exec(part)?.[1]
            return key && key in values ? values[key] : esc(part)
        }).join('')
    }

    private render (): void {
        if (!this.bar) { return }
        const cfg = this.cfg
        this.bar.hidden = !cfg.enabled
        if (!cfg.enabled) {
            this.togglePop(false)
            return
        }
        const left = cfg.align === 'left'
        this.bar.classList.toggle('cu-left', left)

        const u = this.usage
        const main: string[] = []
        if (u && cfg.format.trim()) {
            main.push(`<span class="cu-item">${this.renderFormat(u, cfg.format)}</span>`)
        } else {
            if (cfg.showBrand) { main.push('<span class="cu-brand">✳ Claude</span>') }
            if (u) {
                main.push(...this.renderItems(u, cfg))
            } else if (!this.error) {
                main.push('<span class="cu-muted">loading…</span>')
            }
        }

        let status = ''
        if (this.error) {
            status = `<span class="cu-err" title="${esc(this.error.message)}">⚠ ${esc(this.error instanceof UsageError && this.error.kind === 'rateLimited' ? 'rate limited' : this.error.message)}</span>`
        } else if (this.loading) {
            status = '<span class="cu-muted">refreshing…</span>'
        } else if (u && cfg.showLastUpdated) {
            status = `<span class="cu-muted">${fmtAgo(u.fetchedAt)}</span>`
        }
        // Status text sits on the outer side: after the items when left-aligned, before them when right-aligned.
        this.bar.innerHTML = (left ? [...main, status] : [status, ...main]).join('')
        if (this.popOpen) {
            this.renderPop()
        }
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
                if ((e.target as HTMLElement).dataset.action === 'refresh') {
                    void this.refresh()
                }
            })
            document.body.appendChild(this.pop)
        }
        this.pop.classList.toggle('cu-left', this.cfg.align === 'left')
        const u = this.usage
        const rows: string[] = []
        rows.push(`<h4><span>Claude usage</span><span class="cu-sub">${esc(u?.plan ? u.plan.toUpperCase() : '')}</span></h4>`)
        if (u) {
            for (const w of u.windows) {
                const p = pct(w)
                rows.push(`<div class="cu-row"><div class="cu-row-head"><span>${esc(w.title)}</span><span>${p}% used</span></div>` +
                    `<div class="cu-big"><i style="width:${p}%;background:${this.color(p)}"></i></div>` +
                    (w.resetsAt ? `<div class="cu-sub">Resets in ${resetIn(w)} · ${esc(w.resetsAt.toLocaleString())}</div>` : '') +
                    '</div>')
            }
            if (u.extra) {
                const p = u.extra.limit > 0 ? Math.round(u.extra.used / u.extra.limit * 100) : 0
                rows.push(`<div class="cu-row"><div class="cu-row-head"><span>Extra usage (month)</span><span>${u.extra.used.toFixed(2)} / ${u.extra.limit.toFixed(2)} ${esc(u.extra.currency)}</span></div>` +
                    `<div class="cu-big"><i style="width:${Math.min(p, 100)}%;background:${this.color(p)}"></i></div></div>`)
            }
        }
        if (this.error) {
            rows.push(`<div class="cu-row cu-err">${esc(this.error.message)}</div>`)
        }
        const status = this.loading ? 'Refreshing…' : u ? `Updated ${fmtAgo(u.fetchedAt)} · ${esc(u.credentialSource)}` : ''
        rows.push(`<div class="cu-foot"><span class="cu-sub">${status}</span><button data-action="refresh">Refresh</button></div>`)
        this.pop.innerHTML = rows.join('')
    }
}
