// Run with `npm test` (builds first, then tests the compiled provider modules).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeClaude } = require('../dist/providers/claude')
const { normalizeCodex, jwtExpiry } = require('../dist/providers/codex')

test('claude: session, weekly and model-scoped windows', () => {
    const u = normalizeClaude({
        five_hour: { utilization: 6, resets_at: '2026-10-14T07:09:59Z' },
        seven_day: { utilization: 10, resets_at: '2026-10-16T16:00:00Z' },
        seven_day_sonnet: { utilization: 3, resets_at: null },
        limits: [
            { kind: 'weekly_scoped', group: 'weekly', percent: 6, resets_at: '2026-10-16T16:00:00Z', scope: { model: { display_name: 'Fable' } } },
            { kind: 'weekly_scoped', group: 'weekly', percent: 9, scope: { model: { display_name: 'All models' } } },
            { kind: 'weekly_scoped', group: 'weekly', percent: 1, scope: { model: { display_name: 'Sonnet' } } },
        ],
    })
    assert.equal(u.session.label, '5h')
    assert.equal(u.session.percent, 6)
    assert.equal(u.weekly.label, '7d')
    assert.deepEqual(u.windows.map(w => w.title), ['Session (5h)', 'Weekly (all models)', 'Weekly (Sonnet)', 'Weekly (Fable)'])
    assert.equal(u.windows[3].label, 'Fable')
    assert.equal(u.extra, null)
})

test('claude: extra usage is reported in cents', () => {
    const u = normalizeClaude({ extra_usage: { is_enabled: true, used_credits: 120, monthly_limit: 5000, currency: 'USD' } })
    assert.equal(u.extra.text, '1.20/50 USD')
    assert.equal(u.extra.percent, 2)
    assert.equal(normalizeClaude({ extra_usage: { is_enabled: false, used_credits: 1, monthly_limit: 2 } }).extra, null)
})

test('codex: primary/secondary windows, plan and credits', () => {
    const u = normalizeCodex({
        plan_type: 'plus',
        rate_limit: {
            primary_window: { used_percent: 22, limit_window_seconds: 18000, reset_at: 1792410635 },
            secondary_window: { used_percent: 36, limit_window_seconds: 604800, reset_at: 1792902913 },
        },
        additional_rate_limits: null,
        credits: { has_credits: true, unlimited: false, balance: '62215.8439275000' },
    })
    assert.equal(u.plan, 'plus')
    assert.equal(u.session.label, '5h')
    assert.equal(u.session.percent, 22)
    assert.equal(u.session.resetsAt.getTime(), 1792410635 * 1000)
    assert.equal(u.weekly.label, '7d')
    assert.equal(u.windows.length, 2)
    assert.deepEqual(u.extra, { title: 'Credits balance', label: 'credits', text: '62,215', percent: null })
})

test('codex: additional model-specific limits', () => {
    const u = normalizeCodex({
        rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 18000 } },
        additional_rate_limits: [{
            limit_name: 'GPT-5.3-Codex-Spark',
            rate_limit: {
                primary_window: { used_percent: 40, limit_window_seconds: 18000, reset_at: 1 },
                secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_at: 2 },
            },
        }],
    })
    assert.equal(u.weekly, null)
    assert.deepEqual(u.windows.map(w => w.label), ['5h', 'GPT-5.3-Codex-Spark 5h', 'GPT-5.3-Codex-Spark 7d'])
})

test('codex: unlimited / missing credits', () => {
    assert.equal(normalizeCodex({ credits: { has_credits: true, unlimited: true } }).extra.text, 'unlimited')
    assert.equal(normalizeCodex({ credits: { has_credits: false, balance: '5' } }).extra, null)
    assert.equal(normalizeCodex({}).session, null)
})

test('codex: jwtExpiry reads the exp claim', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1792410635 })).toString('base64url')
    assert.equal(jwtExpiry(`h.${payload}.s`), 1792410635 * 1000)
    assert.equal(jwtExpiry('opaque-token'), null)
    assert.equal(jwtExpiry(`h.${Buffer.from('{"exp":"x"}').toString('base64url')}.s`), null)
})
