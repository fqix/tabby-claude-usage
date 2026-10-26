// Full-window celebration overlay shown when a usage limit resets (detection is in events.ts).
// One canvas runner (sizing, message, teardown, reduced motion) plus pluggable particle effects.

export type EffectId = 'fireworks' | 'confetti' | 'balloons' | 'emoji' | 'random'

export const EFFECTS: [EffectId, string][] = [
    ['fireworks', 'Fireworks'],
    ['confetti', 'Confetti'],
    ['balloons', 'Balloons'],
    ['emoji', 'Emoji rain'],
    ['random', 'Random'],
]

interface Effect {
    /** Fade the previous frame instead of clearing it, leaving trails. */
    trails?: boolean
    /** Advance and draw one frame; spawn new particles only while `emitting`. Returns whether any particle is left. */
    frame (ctx: CanvasRenderingContext2D, w: number, h: number, emitting: boolean, now: number): boolean
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min)
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]
const GRAVITY = 0.06
const PALETTE = ['#e5534b', '#d4a72c', '#57ab5a', '#539bf5', '#b083f0', '#f69d50', '#ec6cb9']

function fireworksEffect (): Effect {
    interface Rocket { x: number, y: number, vy: number, targetY: number, hue: number }
    interface Spark { x: number, y: number, vx: number, vy: number, hue: number, life: number, decay: number }
    const rockets: Rocket[] = []
    const sparks: Spark[] = []
    let nextLaunch = 0

    const explode = (r: Rocket): void => {
        const count = 60 + Math.floor(Math.random() * 40)
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count
            const speed = rand(1.5, 4.5)
            sparks.push({
                x: r.x, y: r.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                hue: r.hue + rand(-20, 20), life: 1, decay: rand(0.012, 0.024),
            })
        }
    }
    return {
        trails: true,
        frame (ctx, w, h, emitting, now) {
            if (emitting && now >= nextLaunch) {
                rockets.push({ x: w * rand(0.15, 0.85), y: h, vy: -(h / 90) * rand(0.85, 1.15), targetY: h * rand(0.15, 0.5), hue: rand(0, 360) })
                nextLaunch = now + rand(180, 500)
            }
            ctx.globalCompositeOperation = 'lighter'
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
            return rockets.length > 0 || sparks.length > 0
        },
    }
}

/** Two cannons in the bottom corners, then a light shower from the top. */
function confettiEffect (): Effect {
    interface Piece { x: number, y: number, vx: number, vy: number, rot: number, vr: number, size: number, color: string, wobble: number }
    const pieces: Piece[] = []
    let fired = false
    const piece = (x: number, y: number, vx: number, vy: number): Piece => ({
        x, y, vx, vy, rot: rand(0, Math.PI * 2), vr: rand(-0.2, 0.2), size: rand(6, 11), color: pick(PALETTE), wobble: rand(0, Math.PI * 2),
    })
    return {
        frame (ctx, w, h, emitting) {
            if (!fired) {
                fired = true
                for (let i = 0; i < 110; i++) {
                    const speed = rand(h / 60, h / 32)
                    const left = rand(-Math.PI * 0.42, -Math.PI * 0.2)
                    pieces.push(piece(0, h, Math.cos(left) * speed, Math.sin(left) * speed))
                    const right = Math.PI - left
                    pieces.push(piece(w, h, Math.cos(right) * speed, Math.sin(right) * speed))
                }
            }
            if (emitting && Math.random() < 0.6) {
                pieces.push(piece(rand(0, w), -10, rand(-1, 1), rand(1, 3)))
            }
            for (let i = pieces.length - 1; i >= 0; i--) {
                const p = pieces[i]
                p.vx *= 0.985
                p.vy = Math.min(p.vy * 0.985 + GRAVITY * 1.5, 4)
                p.wobble += 0.1
                p.x += p.vx + Math.sin(p.wobble) * 0.6
                p.y += p.vy
                p.rot += p.vr
                if (p.y > h + 20 || p.x < -40 || p.x > w + 40) {
                    pieces.splice(i, 1)
                    continue
                }
                ctx.save()
                ctx.translate(p.x, p.y)
                ctx.rotate(p.rot)
                // Squashing one axis makes the piece look like it flips over.
                ctx.scale(1, Math.abs(Math.cos(p.wobble)) * 0.8 + 0.2)
                ctx.fillStyle = p.color
                ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
                ctx.restore()
            }
            return pieces.length > 0
        },
    }
}

/** Balloons drifting up from the bottom edge. */
function balloonsEffect (): Effect {
    interface Balloon { x: number, y: number, vy: number, r: number, color: string, phase: number, sway: number }
    const balloons: Balloon[] = []
    let next = 0
    return {
        frame (ctx, w, h, emitting, now) {
            if (emitting && now >= next) {
                const r = rand(18, 30)
                balloons.push({ x: rand(0.05, 0.95) * w, y: h + r * 2, vy: rand(2.6, 4.6), r, color: pick(PALETTE), phase: rand(0, Math.PI * 2), sway: rand(0.4, 1.2) })
                next = now + rand(90, 220)
            }
            for (let i = balloons.length - 1; i >= 0; i--) {
                const b = balloons[i]
                b.y -= b.vy
                b.phase += 0.03
                const x = b.x + Math.sin(b.phase) * 12 * b.sway
                if (b.y < -b.r * 4) {
                    balloons.splice(i, 1)
                    continue
                }
                // String
                ctx.strokeStyle = 'rgba(200,200,200,.6)'
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(x, b.y + b.r * 1.2)
                ctx.quadraticCurveTo(x + Math.sin(b.phase * 2) * 6, b.y + b.r * 2, x, b.y + b.r * 2.8)
                ctx.stroke()
                // Body, knot and highlight
                ctx.fillStyle = b.color
                ctx.beginPath()
                ctx.ellipse(x, b.y, b.r, b.r * 1.2, 0, 0, Math.PI * 2)
                ctx.fill()
                ctx.beginPath()
                ctx.moveTo(x - 4, b.y + b.r * 1.28)
                ctx.lineTo(x + 4, b.y + b.r * 1.28)
                ctx.lineTo(x, b.y + b.r * 1.15)
                ctx.fill()
                ctx.fillStyle = 'rgba(255,255,255,.35)'
                ctx.beginPath()
                ctx.ellipse(x - b.r * 0.35, b.y - b.r * 0.45, b.r * 0.22, b.r * 0.34, -0.5, 0, Math.PI * 2)
                ctx.fill()
            }
            return balloons.length > 0
        },
    }
}

/** Party emoji falling from the top. */
function emojiEffect (): Effect {
    interface Drop { x: number, y: number, vy: number, rot: number, vr: number, size: number, char: string }
    const chars = ['🎉', '🥳', '🎊', '✨', '🚀', '💯', '⭐']
    const drops: Drop[] = []
    let next = 0
    return {
        frame (ctx, w, h, emitting, now) {
            if (emitting && now >= next) {
                drops.push({ x: rand(0, w), y: -40, vy: rand(2.5, 5), rot: rand(-0.5, 0.5), vr: rand(-0.04, 0.04), size: rand(22, 40), char: pick(chars) })
                next = now + rand(30, 80)
            }
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            for (let i = drops.length - 1; i >= 0; i--) {
                const d = drops[i]
                d.y += d.vy
                d.vy += GRAVITY * 0.5
                d.rot += d.vr
                if (d.y > h + 50) {
                    drops.splice(i, 1)
                    continue
                }
                ctx.save()
                ctx.translate(d.x, d.y)
                ctx.rotate(d.rot)
                ctx.font = `${d.size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
                ctx.fillText(d.char, 0, 0)
                ctx.restore()
            }
            return drops.length > 0
        },
    }
}

const FACTORIES: Record<Exclude<EffectId, 'random'>, () => Effect> = {
    fireworks: fireworksEffect,
    confetti: confettiEffect,
    balloons: balloonsEffect,
    emoji: emojiEffect,
}

/** Full-window `effect` with `message` in the middle; pointer events pass through. Ignored while one is running. */
export function celebrate (effect: EffectId, message: string, durationMs = 4500): void {
    if (document.getElementById('claude-usage-celebration')) { return }
    const id = effect !== 'random' && effect in FACTORIES ? effect : pick(Object.keys(FACTORIES)) as keyof typeof FACTORIES
    const fx = FACTORIES[id]()

    const canvas = document.createElement('canvas')
    canvas.id = 'claude-usage-celebration'
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
    const start = performance.now()

    const frame = (now: number): void => {
        const t = now - start
        // The window can be 0×0 for a moment right after load; sizes are read every frame.
        if (w !== window.innerWidth || h !== window.innerHeight) {
            resize()
        }
        if (fx.trails) {
            ctx.globalCompositeOperation = 'destination-out'
            ctx.fillStyle = 'rgba(0,0,0,.22)'
            ctx.fillRect(0, 0, w, h)
        } else {
            ctx.clearRect(0, 0, w, h)
        }
        ctx.globalCompositeOperation = 'source-over'
        const alive = !reduced && w > 0 && h > 0 && fx.frame(ctx, w, h, t < durationMs * 0.65, now)

        // Message: fades in, holds, fades out at the end.
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = Math.max(0, Math.min(1, t / 300, (durationMs - t) / 600))
        ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,.6)'
        ctx.shadowBlur = 12
        ctx.fillStyle = '#fff'
        ctx.fillText(message, w / 2, h * 0.45)
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1

        // Keep going until the message is gone and the particles have left (capped, in case some never do).
        if ((t < durationMs || alive) && t < durationMs * 2.5) {
            requestAnimationFrame(frame)
        } else {
            canvas.remove()
        }
    }
    requestAnimationFrame(frame)
}
