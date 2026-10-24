// Fireworks overlay shown when a usage limit resets, plus the reset detection behind it.

import { ProviderId, UsageWindow } from './providers/types'

export type WindowSnapshot = Pick<UsageWindow, 'title' | 'percent' | 'resetsAt'>

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

// Last seen windows per provider, so a reset that happened while Tabby was closed is still noticed.
const SNAPSHOT_KEY = 'claudeUsage.windows'

function readSnapshots (): Record<string, any[]> {
    try {
        return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? '{}') ?? {}
    } catch {
        return {}
    }
}

export function loadSnapshot (id: ProviderId): WindowSnapshot[] {
    const list = readSnapshots()[id]
    if (!Array.isArray(list)) { return [] }
    return list.map(w => ({ title: String(w.title), percent: Number(w.percent), resetsAt: w.resetsAt ? new Date(w.resetsAt) : null }))
}

export function saveSnapshot (id: ProviderId, windows: WindowSnapshot[]): void {
    try {
        const all = readSnapshots()
        all[id] = windows.map(({ title, percent, resetsAt }) => ({ title, percent, resetsAt }))
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(all))
    } catch { }
}

interface Spark {
    x: number
    y: number
    vx: number
    vy: number
    hue: number
    life: number
    decay: number
}

interface Rocket {
    x: number
    y: number
    vy: number
    targetY: number
    hue: number
}

const GRAVITY = 0.06

/** Full-window fireworks with `message` in the middle; pointer events pass through. Ignored while one is running. */
export function fireworks (message: string, durationMs = 4500): void {
    if (document.getElementById('claude-usage-fireworks')) { return }
    const canvas = document.createElement('canvas')
    canvas.id = 'claude-usage-fireworks'
    Object.assign(canvas.style, {
        position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '2000',
    })
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')!
    let w = 0
    let h = 0
    const resize = (): void => {
        const dpr = window.devicePixelRatio || 1
        w = window.innerWidth
        h = window.innerHeight
        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // With reduced motion, only the message is shown.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const rockets: Rocket[] = []
    const sparks: Spark[] = []
    const start = performance.now()
    let nextLaunch = start

    const launch = (): void => {
        rockets.push({
            x: w * (0.15 + Math.random() * 0.7),
            y: h,
            vy: -(h / 90) * (0.85 + Math.random() * 0.3),
            targetY: h * (0.15 + Math.random() * 0.35),
            hue: Math.random() * 360,
        })
    }
    const explode = (r: Rocket): void => {
        const count = 60 + Math.floor(Math.random() * 40)
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count
            const speed = 1.5 + Math.random() * 3
            sparks.push({
                x: r.x, y: r.y,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                hue: r.hue + Math.random() * 40 - 20,
                life: 1, decay: 0.012 + Math.random() * 0.012,
            })
        }
    }

    const frame = (now: number): void => {
        const t = now - start
        if (w !== window.innerWidth || h !== window.innerHeight) {
            resize()
        }
        // Fade the previous frame for trails, keeping the canvas transparent.
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = 'rgba(0,0,0,.22)'
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'

        if (!reduced && w > 0 && h > 0 && t < durationMs * 0.65 && now >= nextLaunch) {
            launch()
            nextLaunch = now + 180 + Math.random() * 320
        }
        for (let i = rockets.length - 1; i >= 0; i--) {
            const r = rockets[i]
            r.y += r.vy
            r.vy += GRAVITY
            ctx.fillStyle = `hsl(${r.hue},100%,75%)`
            ctx.fillRect(r.x - 1.5, r.y - 1.5, 3, 3)
            if (r.y <= r.targetY || r.vy >= 0) {
                explode(r)
                rockets.splice(i, 1)
            }
        }
        for (let i = sparks.length - 1; i >= 0; i--) {
            const s = sparks[i]
            s.x += s.vx
            s.y += s.vy
            s.vx *= 0.98
            s.vy = s.vy * 0.98 + GRAVITY
            s.life -= s.decay
            if (s.life <= 0) {
                sparks.splice(i, 1)
                continue
            }
            ctx.fillStyle = `hsla(${s.hue},100%,62%,${s.life})`
            ctx.beginPath()
            ctx.arc(s.x, s.y, 2, 0, Math.PI * 2)
            ctx.fill()
        }

        // Message: fades in, holds, fades out at the end.
        const alpha = Math.max(0, Math.min(1, t / 300, (durationMs - t) / 600))
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = alpha
        ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,.6)'
        ctx.shadowBlur = 12
        ctx.fillStyle = '#fff'
        ctx.fillText(message, w / 2, h * 0.45)
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1

        if (t < durationMs || rockets.length || sparks.length) {
            requestAnimationFrame(frame)
        } else {
            canvas.remove()
        }
    }
    requestAnimationFrame(frame)
}
