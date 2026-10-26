// Run with `npm test` (builds first, then tests the compiled module).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { detectResets, detectEvents, claimEvents, DEFAULT_RULES } = require('../dist/events')

const win = (title, percent, resetsAt) => ({ title, label: title, percent, resetsAt: resetsAt ? new Date(resetsAt) : null })

test('reset: usage dropped and the window rolled over', () => {
    const prev = [win('Session (5h)', 80, '2026-10-24T05:00:00Z'), win('Weekly', 60, '2026-10-27T00:00:00Z')]
    const next = [win('Session (5h)', 0, '2026-10-24T10:00:00Z'), win('Weekly', 61, '2026-10-27T00:00:00Z')]
    assert.deepEqual(detectResets(prev, next, 50).map(w => w.title), ['Session (5h)'])
})

test('reset: a window with no reset time after it expired counts', () => {
    assert.equal(detectResets([win('Session (5h)', 90, '2026-10-24T05:00:00Z')], [win('Session (5h)', 0, null)], 50).length, 1)
})

test('no reset: below the minimum, unused, or the same window', () => {
    assert.equal(detectResets([win('S', 30, '2026-10-24T05:00:00Z')], [win('S', 0, '2026-10-24T10:00:00Z')], 50).length, 0)
    assert.equal(detectResets([win('S', 0, '2026-10-24T05:00:00Z')], [win('S', 0, '2026-10-24T10:00:00Z')], 0).length, 0)
    assert.equal(detectResets([win('S', 80, '2026-10-24T05:00:00Z')], [win('S', 70, '2026-10-24T05:00:00Z')], 50).length, 0)
    assert.equal(detectResets([], [win('S', 0, '2026-10-24T10:00:00Z')], 0).length, 0)
})

test('reset: minimum 0 celebrates any reset after use', () => {
    assert.equal(detectResets([win('S', 3, '2026-10-24T05:00:00Z')], [win('S', 0, '2026-10-24T10:00:00Z')], 0).length, 1)
})

const claude = { id: 'claude', name: 'Claude' }
const session = (percent, resetsAt) => win('Session (5h)', percent, resetsAt)
const weekly = (percent, resetsAt) => win('Weekly', percent, resetsAt)
const kindOf = w => w.title === 'Session (5h)' ? 'session' : w.title === 'Weekly' ? 'weekly' : 'model'
const rule = (r) => ({ enabled: true, provider: 'any', window: 'any', event: 'threshold', threshold: 80, ...r })

test('events: session reset rule matches only the session window', () => {
    const prev = [session(90, '2026-10-24T05:00:00Z'), weekly(70, '2026-10-24T05:00:00Z')]
    const next = [session(0, '2026-10-24T10:00:00Z'), weekly(0, '2026-10-31T05:00:00Z')]
    const events = detectEvents(claude, prev, next, kindOf, [rule({ window: 'session', event: 'reset' })], 50)
    assert.deepEqual(events.map(e => [e.type, e.window.title, e.kind, e.provider]), [['reset', 'Session (5h)', 'session', 'claude']])
})

test('events: crossing several thresholds reports the highest once', () => {
    const events = detectEvents(claude, [weekly(50, 'x')], [weekly(95, 'x')], kindOf,
        [rule({ threshold: 80 }), rule({ threshold: 90 }), rule({ threshold: 99 })], 50)
    assert.deepEqual(events.map(e => [e.type, e.threshold]), [['threshold', 90]])
})

test('events: disabled rules, other providers and already-above usage do not match', () => {
    const prev = [weekly(85, 'x')]
    const next = [weekly(92, 'x')]
    assert.equal(detectEvents(claude, prev, next, kindOf, [rule({ enabled: false, threshold: 90 })], 50).length, 0)
    assert.equal(detectEvents(claude, prev, next, kindOf, [rule({ provider: 'codex', threshold: 90 })], 50).length, 0)
    assert.equal(detectEvents(claude, prev, next, kindOf, [rule({ threshold: 80 })], 50).length, 0)
    assert.equal(detectEvents(claude, [], next, kindOf, [rule({ threshold: 90 })], 50).length, 0)
})

test('events: default rules cover session/weekly resets and 90%', () => {
    assert.deepEqual(DEFAULT_RULES.map(r => [r.window, r.event]), [['session', 'reset'], ['weekly', 'reset'], ['any', 'threshold']])
})

test('claimEvents: each event is claimed once across windows', () => {
    const store = new Map()
    globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
    try {
        const [e] = detectEvents(claude, [weekly(50, '2026-10-24T05:00:00Z')], [weekly(95, '2026-10-24T05:00:00Z')], kindOf, [rule({ threshold: 90 })], 50)
        assert.equal(claimEvents([e]).length, 1)
        assert.equal(claimEvents([e]).length, 0)
    } finally {
        delete globalThis.localStorage
    }
})

