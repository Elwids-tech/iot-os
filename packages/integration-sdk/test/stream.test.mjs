import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { IotClient, IotApiError, IotContractError, IotTransportError } from '../dist/index.js'

// The telemetry stream iterator of spec 030 against a scripted fetch: each connection
// is a list of chunks (strings), optionally dropped mid-way, with the response status
// and content type a test needs. The frames are the contracts' own fixtures:
// telemetry-stream-open.v1, telemetry-stream.v1, telemetry-stream-reset.v1 and
// telemetry-stream-closed.v1.

const id = '00000000-0000-4000-8000-000000000001'
const device = '00000000-0000-4000-8000-000000000002'
const token = 'secret-for-test-never-logged'
const frame = (event, id, data) => `event: ${event}\n${id === null ? '' : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`
const open = (position, devices = 2) => frame('open', null, { schema_version: 'telemetry-stream-open.v1', position, devices, opened_at: '2026-11-07T09:41:58Z' })
const reading = (position, extra = {}) => frame('reading', position, { schema_version: 'telemetry-stream.v1', position, event_id: id, device_uuid: device, configuration_uuid: id, generation: 1,
  readings: [{ parameter_uuid: id, key: 'flow', data_type: 'number', unit: 'L/min', value: 12.5, quality: 'good', observed_at: '2026-11-07T09:41:57Z', received_at: '2026-11-07T09:41:58Z', historical: false }], ...extra })
const reset = (position) => frame('reset', null, { schema_version: 'telemetry-stream-reset.v1', position })
const closed = (reason, position) => frame('closed', null, { schema_version: 'telemetry-stream-closed.v1', reason, position })

/** A fetch serving one scripted connection per call; the last connection stays open until the signal aborts. */
function scripted(connections) {
  const calls = []
  const fetch = async (url, options) => {
    const spec = connections[calls.length] ?? { chunks: [] }
    calls.push({ url, options })
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    if (spec.throw) throw new Error(spec.throw)
    if (spec.status && spec.status !== 200) return Response.json({ message: 'refused', token }, { status: spec.status, headers: spec.headers ?? {} })
    const encoder = new TextEncoder()
    const queue = [...spec.chunks]
    // One chunk per pull, so a drop or close arrives after every chunk was read, as a socket delivers them.
    const body = new ReadableStream({
      start(controller) {
        options.signal?.addEventListener('abort', () => { try { controller.error(new DOMException('aborted', 'AbortError')) } catch {} })
      },
      pull(controller) {
        if (queue.length) return controller.enqueue(encoder.encode(queue.shift()))
        if (spec.drop) controller.error(new TypeError('connection dropped'))
        else if (spec.close) controller.close()
        else return new Promise(() => {}) // stays open until the signal aborts
      },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': spec.contentType ?? 'text/event-stream; charset=utf-8' } })
  }
  return { fetch, calls }
}
const make = (fetch) => new IotClient({ baseUrl: 'https://iot.example.test', organization: id, token, fetch })
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve)) }
/** Reads n events, ticking the mocked clock so backoff waits pass at once. */
async function take(iterator, n) {
  const events = []
  while (events.length < n) {
    const pending = iterator.next()
    pending.catch(() => undefined) // handled below; a rejection must not count as unhandled while the clock ticks
    for (let i = 0; i < 3; i++) { await settle(); mock.timers.tick(30000) }
    const { value, done } = await pending
    if (done) break
    events.push(value)
  }
  return events
}
const useMockTimers = (t) => { mock.timers.enable({ apis: ['setTimeout'] }); t.after(() => mock.timers.reset()) }

test('a fresh stream yields open and readings, and resumes with the last id after the lifetime close', async (t) => {
  useMockTimers(t)
  const { fetch, calls } = scripted([
    { chunks: [open('41'), ': keepalive\n\n', reading('42'), reading('43').slice(0, 30), reading('43').slice(30), closed('lifetime', '43')], close: true },
    { chunks: [open('43'), reading('44')] },
  ])
  const controller = new AbortController()
  const iterator = make(fetch).telemetryStream({ signal: controller.signal })
  const events = await take(iterator, 5)
  assert.deepEqual(events.map((event) => [event.type, event.position]), [['open', '41'], ['reading', '42'], ['reading', '43'], ['open', '43'], ['reading', '44']])
  assert.equal(events[0].devices, 2)
  assert.equal(events[1].deviceUuid, device)
  assert.equal(events[1].readings[0].value, 12.5)
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /\/telemetry\/stream$/)
  assert.equal(calls[0].options.headers.Accept, 'text/event-stream')
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`)
  assert.equal(calls[0].options.headers['Last-Event-ID'], undefined)
  assert.equal(calls[0].options.credentials, 'omit')
  assert.equal(calls[0].options.redirect, 'error')
  assert.equal(calls[1].options.headers['Last-Event-ID'], '43', 'the reconnect resumes from the last reading')
  controller.abort()
  const end = await iterator.next()
  assert.equal(end.done, true, 'aborting the signal ends the iteration quietly')
})

test('a resume carries Last-Event-ID and the device subset, and invalid options are refused before fetch', async (t) => {
  useMockTimers(t)
  const { fetch, calls } = scripted([{ chunks: [open('7', 1)] }])
  const controller = new AbortController()
  const iterator = make(fetch).telemetryStream({ after: '7', devices: [device], signal: controller.signal })
  assert.deepEqual((await take(iterator, 1)).map((event) => event.type), ['open'])
  assert.equal(calls[0].options.headers['Last-Event-ID'], '7')
  assert.match(calls[0].url, /\/telemetry\/stream\?devices%5B%5D=00000000-0000-4000-8000-000000000002$/)
  controller.abort()
  await iterator.next()
  const client = make(async () => { throw new Error('must not fetch') })
  for (const options of [{ after: '042' }, { after: 'abc' }, { devices: [] }, { devices: [device, device] }, { devices: ['not-a-uuid'] }, { devices: Array.from({ length: 1001 }, () => id) }, { maxRetryMs: -1 }]) {
    await assert.rejects(client.telemetryStream(options).next(), TypeError)
  }
})

test('a reset is yielded and the iterator continues from the head it carries', async (t) => {
  useMockTimers(t)
  const { fetch, calls } = scripted([
    { chunks: [reset('9031')], close: true },
    { chunks: [open('9031'), reading('9032')] },
  ])
  const controller = new AbortController()
  const iterator = make(fetch).telemetryStream({ after: '12', signal: controller.signal })
  const events = await take(iterator, 3)
  assert.deepEqual(events.map((event) => [event.type, event.position]), [['reset', '9031'], ['open', '9031'], ['reading', '9032']])
  assert.equal(calls[0].options.headers['Last-Event-ID'], '12')
  assert.equal(calls[1].options.headers['Last-Event-ID'], '9031')
  controller.abort()
  await iterator.next()
})

test('every closed reason is followed by a reconnect from the closed position', async (t) => {
  useMockTimers(t)
  const reasons = ['lifetime', 'grant_changed', 'credentials_changed', 'runtime_unavailable', 'shutdown']
  const connections = reasons.map((reason, index) => ({ chunks: [open(String(10 + index)), closed(reason, String(20 + index))], close: true }))
  connections.push({ chunks: [open('99')] })
  const { fetch, calls } = scripted(connections)
  const controller = new AbortController()
  const iterator = make(fetch).telemetryStream({ signal: controller.signal })
  const events = await take(iterator, reasons.length + 1)
  assert.deepEqual(events.map((event) => event.type), Array(reasons.length + 1).fill('open'), 'closed is never surfaced')
  assert.deepEqual(calls.slice(1).map((call) => call.options.headers['Last-Event-ID']), ['20', '21', '22', '23', '24'])
  controller.abort()
  await iterator.next()
})

test('a body dropped mid-event yields nothing partial and reconnects with the last complete id', async (t) => {
  useMockTimers(t)
  const partial = reading('43').slice(0, 60)
  const { fetch, calls } = scripted([
    { chunks: [open('41'), reading('42'), partial], drop: true },
    { chunks: [open('42'), reading('44')] },
  ])
  const controller = new AbortController()
  const iterator = make(fetch).telemetryStream({ signal: controller.signal })
  const events = await take(iterator, 4)
  assert.deepEqual(events.map((event) => [event.type, event.position]), [['open', '41'], ['reading', '42'], ['open', '42'], ['reading', '44']])
  assert.equal(calls[1].options.headers['Last-Event-ID'], '42')
  controller.abort()
  await iterator.next()
})

test('each event example of the four contracts is parsed', async (t) => {
  useMockTimers(t)
  const fixture = async (name) => JSON.parse(await readFile(new URL(`../../../contracts/events/v1/${name}.fixture.json`, import.meta.url), 'utf8'))
  const [openFixture, readingFixture, resetFixture, closedFixture] = await Promise.all(['telemetry-stream-open', 'telemetry-stream', 'telemetry-stream-reset', 'telemetry-stream-closed'].map(fixture))
  const { fetch, calls } = scripted([
    { chunks: [frame('open', null, openFixture), frame('reading', readingFixture.position, readingFixture), frame('closed', null, closedFixture)], close: true },
    { chunks: [frame('open', null, { ...openFixture, position: closedFixture.position }), frame('reset', null, resetFixture)], close: true },
    { chunks: [frame('open', null, { ...openFixture, position: resetFixture.position })] },
  ])
  const controller = new AbortController()
  const iterator = make(fetch).telemetryStream({ signal: controller.signal })
  const events = await take(iterator, 5)
  assert.deepEqual(events.map((event) => [event.type, event.position]), [['open', openFixture.position], ['reading', readingFixture.position], ['open', closedFixture.position], ['reset', resetFixture.position], ['open', resetFixture.position]])
  assert.equal(events[1].eventId, readingFixture.event_id)
  assert.deepEqual(events[1].readings, readingFixture.readings)
  assert.equal(events[0].openedAt, openFixture.opened_at)
  assert.equal(calls[2].options.headers['Last-Event-ID'], resetFixture.position)
  controller.abort()
  await iterator.next()
})

test('refusals are thrown without the token, a 503 and a dropped handshake are retried, and malformed frames are contract errors', async (t) => {
  useMockTimers(t)
  for (const status of [401, 403, 404, 422, 429]) {
    const { fetch } = scripted([{ status, headers: status === 429 ? { 'Retry-After': '30' } : {} }])
    await assert.rejects(make(fetch).telemetryStream().next(), (error) => error instanceof IotApiError && error.status === status && !error.message.includes(token) && (status !== 429 || error.retryAfterSeconds === 30))
  }
  const retried = scripted([{ status: 503 }, { throw: `connection refused for ${token}` }, { chunks: [open('5')] }])
  const controller = new AbortController()
  const iterator = make(retried.fetch).telemetryStream({ signal: controller.signal })
  assert.deepEqual((await take(iterator, 1)).map((event) => event.position), ['5'])
  assert.equal(retried.calls.length, 3)
  controller.abort()
  await iterator.next()
  // Consecutive failures beyond maxRetryMs end in a transport error that carries no secret.
  const failing = scripted([{ throw: token }, { throw: token }, { throw: token }])
  const exhausted = make(failing.fetch).telemetryStream({ maxRetryMs: 1500 })
  const pending = assert.rejects(exhausted.next(), (error) => error instanceof IotTransportError && !error.message.includes(token))
  for (let i = 0; i < 4; i++) { await settle(); mock.timers.tick(30000) }
  await pending
  assert.equal(failing.calls.length, 3, 'two retries fit in 1500 ms of backoff')
  for (const bad of [{ contentType: 'application/json', chunks: ['{}'] }, { chunks: [open('x')] }, { chunks: [open('1'), frame('reading', '2', { schema_version: 'telemetry-stream.v1', position: '3', event_id: id, device_uuid: device, configuration_uuid: id, generation: 1, readings: [] })] }]) {
    const { fetch } = scripted([bad])
    await assert.rejects((async () => { for await (const ignored of make(fetch).telemetryStream()) {} })(), IotContractError)
  }
})
