// Run with `npm test` (builds first, then tests the compiled module).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { webhookBodies, eventMessage, renderTemplate, sendWebhook, DEFAULT_TEMPLATE } = require('../dist/webhook')

const event = (over = {}) => ({
    type: 'threshold', provider: 'claude', providerName: 'Claude', kind: 'session', previousPercent: 85, threshold: 90,
    window: { title: 'Session (5h)', label: '5h', percent: 91.6, resetsAt: null }, ...over,
})

test('webhook: messages for thresholds and resets', () => {
    assert.equal(eventMessage(event()), '⚠️ Claude Session (5h) at 92% (≥ 90%)')
    assert.equal(eventMessage(event({ type: 'reset', threshold: null, previousPercent: 82 })), '🎉 Claude Session (5h) reset (was 82%)')
})

function serve (status, reply) {
    return new Promise(resolve => {
        const received = []
        const server = http.createServer((req, res) => {
            let body = ''
            req.on('data', c => { body += c })
            req.on('end', () => {
                received.push({ method: req.method, type: req.headers['content-type'], body: JSON.parse(body) })
                res.writeHead(status, { 'Content-Type': 'application/json' }).end(reply)
            })
        })
        server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/hook`, received, close: () => server.close() }))
    })
}

test('sendWebhook: POSTs JSON and accepts 2xx', async () => {
    const s = await serve(200, '{"errcode":0,"errmsg":"ok"}')
    try {
        await sendWebhook(s.url, { text: 'hi' })
        assert.deepEqual(s.received, [{ method: 'POST', type: 'application/json', body: { text: 'hi' } }])
    } finally { s.close() }
})

test('sendWebhook: rejects HTTP errors, error codes in a 200, and bad URLs', async () => {
    const bad = await serve(500, 'boom')
    const coded = await serve(200, '{"code":19021,"msg":"sign match fail"}')
    try {
        await assert.rejects(sendWebhook(bad.url, {}), /HTTP 500/)
        await assert.rejects(sendWebhook(coded.url, {}), /Rejected \(19021\): sign match fail/)
        await assert.rejects(sendWebhook('ftp://x', {}), /must start with http/)
    } finally { bad.close(); coded.close() }
})

test('template: whole-value placeholders keep their JSON type, embedded ones are escaped text', () => {
    const body = renderTemplate(`{
        "text": "{{text}}", "pct": "{{ percent }}", "thr": "{{threshold}}", "reset": "{{resets_at}}",
        "line": "{{provider_name}}: {{percent}}% \\"{{window}}\\"", "unknown": "{{nope}}", "nested": { "k": ["{{kind}}"] }
    }`, event({ window: { title: 'Session "5h"', label: '5h', percent: 91.6, resetsAt: null } }))
    assert.deepEqual(body, {
        text: '⚠️ Claude Session "5h" at 92% (≥ 90%)', pct: 92, thr: 90, reset: null,
        line: 'Claude: 92% "Session "5h""', unknown: '{{nope}}', nested: { k: ['session'] },
    })
})

test('template: invalid JSON and the default template', () => {
    assert.throws(() => renderTemplate('{ "a": {{percent}} ', event()), /Template is not valid JSON/)
    assert.deepEqual(renderTemplate(DEFAULT_TEMPLATE, event()), {
        text: '⚠️ Claude Session (5h) at 92% (≥ 90%)', type: 'threshold', provider: 'claude', window: 'Session (5h)',
        percent: 92, threshold: 90, resets_at: null,
    })
})

test('webhookBodies: one body per event; an empty template uses the default', () => {
    const events = [event(), event({ type: 'reset', threshold: null })]
    assert.deepEqual(webhookBodies(events, '{"t":"{{type}}"}'), [{ t: 'threshold' }, { t: 'reset' }])
    assert.equal(webhookBodies(events, '  ')[1].type, 'reset')
})
