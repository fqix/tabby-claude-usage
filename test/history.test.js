// Run with `npm test` (builds first, then tests the compiled modules).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sessionSeries, project, recordSample, loadSamples, SESSION_MS } = require('../dist/history')
const { sessionChartSvg } = require('../dist/chart')

const H = 3600 * 1000
const end = Date.parse('2026-10-26T10:00:00Z')
const start = end - SESSION_MS
const session = { title: 'Session (5h)', label: '5h', percent: 40, resetsAt: new Date(end) }

test('sessionSeries: starts at 0% and keeps only samples in the window, sorted', () => {
    const s = sessionSeries([[start + 2 * H, 40], [start - H, 90], [start + H, 20]], session)
    assert.deepEqual(s, { start, end, points: [[start, 0], [start + H, 20], [start + 2 * H, 40]] })
    assert.equal(sessionSeries([], { ...session, resetsAt: null }), null)
})

test('project: pace below and above the limit', () => {
    // 30% after 2h of 5h: ~75% at reset; 50% after 1h: hits 100% at 2h.
    const slow = project({ start, end, points: [[start, 0], [start + 2 * H, 30]] })
    assert.equal(Math.round(slow.atReset), 75)
    assert.equal(slow.hitsLimitAt, null)
    const fast = project({ start, end, points: [[start, 0], [start + H, 50]] })
    assert.equal(Math.round(fast.atReset), 250)
    assert.equal(fast.hitsLimitAt, start + 2 * H)
    assert.equal(project({ start, end, points: [[start, 0]] }), null)
})

test('recordSample: keeps 24h of samples per provider', () => {
    const store = new Map()
    globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
    try {
        recordSample('claude', { ...session, percent: 10 }, end - 30 * H)
        recordSample('claude', { ...session, percent: 20 }, end)
        recordSample('claude', null, end)
        recordSample('codex', { ...session, percent: 5 }, end)
        assert.deepEqual(loadSamples('claude'), [[end, 20]])
        assert.deepEqual(loadSamples('codex'), [[end, 5]])
    } finally {
        delete globalThis.localStorage
    }
})

test('sessionChartSvg: line, thresholds, now marker and projection', () => {
    const series = { start, end, points: [[start, 0], [start + H, 50]] }
    const svg = sessionChartSvg(series, project(series), start + H, {
        color: '#d97757', warnThreshold: 70, criticalThreshold: 90, warnColor: '#d4a72c', criticalColor: '#e5534b',
    })
    assert.match(svg, /^<svg class="cu-chart"/)
    assert.match(svg, /<polyline points="0,63 60,32"/)
    assert.equal((svg.match(/stroke-dasharray="3 3"/g) ?? []).length, 2)
    // Projected to hit 100% two hours in (x = 120), drawn in the critical color.
    assert.match(svg, /x2="120" y2="1" stroke="#e5534b"/)
    assert.match(svg, /x1="60" x2="60" y1="0"/)
})
