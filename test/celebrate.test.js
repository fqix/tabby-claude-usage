// Run with `npm test` (builds first, then tests the compiled module).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { detectResets } = require('../dist/celebrate')

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
