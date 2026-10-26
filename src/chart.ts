// SVG chart of the current session window: usage so far, thresholds, now, and the projected pace.

import { Projection, SessionSeries } from './history'

const W = 300
const H = 64

export interface ChartStyle {
    color: string
    warnThreshold: number
    criticalThreshold: number
    warnColor: string
    criticalColor: string
}

export function sessionChartSvg (series: SessionSeries, projection: Projection | null, now: number, style: ChartStyle): string {
    const x = (t: number): number => +(Math.max(0, Math.min(1, (t - series.start) / (series.end - series.start))) * W).toFixed(1)
    const y = (pct: number): number => +(H - 1 - Math.max(0, Math.min(100, pct)) / 100 * (H - 2)).toFixed(1)
    const line = series.points.map(([t, p]) => `${x(t)},${y(p)}`).join(' ')
    const [lastT, lastP] = series.points[series.points.length - 1]
    const stroke = 'vector-effect="non-scaling-stroke"'

    const parts: string[] = [
        `<line x1="0" x2="${W}" y1="${y(100)}" y2="${y(100)}" stroke="rgba(128,128,128,.35)" ${stroke}/>`,
        `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(128,128,128,.35)" ${stroke}/>`,
    ]
    for (const [pct, color] of [[style.warnThreshold, style.warnColor], [style.criticalThreshold, style.criticalColor]] as [number, string][]) {
        if (pct > 0 && pct < 100) {
            parts.push(`<line x1="0" x2="${W}" y1="${y(pct)}" y2="${y(pct)}" stroke="${color}" stroke-opacity=".55" stroke-dasharray="3 3" ${stroke}/>`)
        }
    }
    parts.push(`<polygon points="${x(series.start)},${y(0)} ${line} ${x(lastT)},${y(0)}" fill="${style.color}" fill-opacity=".18"/>`)
    parts.push(`<polyline points="${line}" fill="none" stroke="${style.color}" stroke-width="1.5" stroke-linejoin="round" ${stroke}/>`)
    if (projection) {
        const [endT, endP] = projection.hitsLimitAt !== null && projection.hitsLimitAt < series.end
            ? [projection.hitsLimitAt, 100]
            : [series.end, projection.atReset]
        const color = endP >= 100 ? style.criticalColor : style.color
        parts.push(`<line x1="${x(lastT)}" y1="${y(lastP)}" x2="${x(endT)}" y2="${y(endP)}" stroke="${color}" stroke-opacity=".8" stroke-dasharray="4 3" ${stroke}/>`)
    }
    if (now > series.start && now < series.end) {
        parts.push(`<line x1="${x(now)}" x2="${x(now)}" y1="0" y2="${H}" stroke="currentColor" stroke-opacity=".35" ${stroke}/>`)
    }
    return `<svg class="cu-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}">${parts.join('')}</svg>`
}
