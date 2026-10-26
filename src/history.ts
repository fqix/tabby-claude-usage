// Session (5h) usage samples over time, for the chart in the details popover.

import { ProviderId, UsageWindow } from './providers/types'

export const SESSION_MS = 5 * 60 * 60 * 1000
const KEEP_MS = 24 * 60 * 60 * 1000
const MAX_SAMPLES = 500
const HISTORY_KEY = 'claudeUsage.sessionHistory'

/** [time (ms), percent] */
export type Sample = [number, number]

function readAll (): Record<string, Sample[]> {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') ?? {}
    } catch {
        return {}
    }
}

export function loadSamples (id: ProviderId): Sample[] {
    const list = readAll()[id]
    return Array.isArray(list) ? list.filter(s => Array.isArray(s) && s.length === 2) : []
}

export function recordSample (id: ProviderId, session: UsageWindow | null, now = Date.now()): void {
    if (!session) { return }
    try {
        const all = readAll()
        all[id] = [...loadSamples(id), [now, session.percent] as Sample]
            .filter(([t]) => now - t <= KEEP_MS)
            .slice(-MAX_SAMPLES)
        localStorage.setItem(HISTORY_KEY, JSON.stringify(all))
    } catch { }
}

export interface SessionSeries {
    start: number
    end: number
    /** Starts at 0% at the window start (a session window opens with the first request). */
    points: Sample[]
}

/** The samples inside the current session window, or null when its reset time is unknown. */
export function sessionSeries (samples: Sample[], session: UsageWindow): SessionSeries | null {
    if (!session.resetsAt) { return null }
    const end = session.resetsAt.getTime()
    const start = end - SESSION_MS
    const inside = samples.filter(([t]) => t >= start && t <= end).sort((a, b) => a[0] - b[0])
    return { start, end, points: [[start, 0], ...inside] }
}

export interface Projection {
    /** Usage expected at the reset time at the current average pace (may exceed 100). */
    atReset: number
    /** When the limit would be hit, if before the reset. */
    hitsLimitAt: number | null
}

/** Linear projection from the window start through the latest sample. */
export function project (series: SessionSeries): Projection | null {
    const [t, pct] = series.points[series.points.length - 1]
    if (t <= series.start || pct <= 0 || t >= series.end) { return null }
    const rate = pct / (t - series.start)
    const atReset = pct + rate * (series.end - t)
    const hitsLimitAt = pct >= 100 ? t : atReset >= 100 ? t + (100 - pct) / rate : null
    return { atReset, hitsLimitAt }
}
