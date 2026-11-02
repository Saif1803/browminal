import { describe, expect, test } from 'bun:test'
import {
  formatBytes,
  formatNetworkDetail,
  formatNetworkLine,
  NetworkLog,
  NETWORK_IDLE_MS,
  redactHeaders
} from './network-log'

const sent = (
  requestId: string,
  url: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  requestId,
  type: 'Fetch',
  timestamp: 100,
  wallTime: 1_700_000_000,
  request: { url, method: 'GET', headers: { Accept: '*/*' } },
  ...extra
})

describe('NetworkLog', () => {
  test('follows a request from start to finish', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(sent('r1', 'http://localhost:5173/api/cart'), 0)
    expect(log.query().entries[0]).toMatchObject({ id: 1, state: 'pending', status: null })
    log.responseReceived({
      requestId: 'r1',
      type: 'Fetch',
      response: {
        status: 200,
        statusText: 'OK',
        mimeType: 'application/json',
        headers: { 'Content-Type': 'application/json' }
      }
    })
    log.loadingFinished({ requestId: 'r1', timestamp: 100.085, encodedDataLength: 1234 }, 90)
    const [entry] = log.query().entries
    expect(entry).toMatchObject({
      state: 'done',
      status: 200,
      mimeType: 'application/json',
      size: 1234,
      startTime: 1_700_000_000_000
    })
    expect(entry.durationMs).toBeCloseTo(85)
    expect(formatNetworkLine(entry)).toBe(
      '#1 GET 200 Fetch http://localhost:5173/api/cart · 1.2 kB · 85 ms'
    )
  })

  test('failures, including blocked and cancelled requests', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(sent('a', 'http://localhost:9/x'))
    log.loadingFailed({
      requestId: 'a',
      timestamp: 100.01,
      errorText: 'net::ERR_CONNECTION_REFUSED'
    })
    log.requestWillBeSent(sent('b', 'https://ads.example/x.js', { type: 'Script' }))
    log.loadingFailed({
      requestId: 'b',
      errorText: 'net::ERR_BLOCKED_BY_CLIENT',
      blockedReason: 'inspector'
    })
    log.requestWillBeSent(sent('c', 'http://localhost/y'))
    log.loadingFailed({ requestId: 'c', canceled: true })
    expect(log.query().entries.map((e) => e.error)).toEqual([
      'net::ERR_CONNECTION_REFUSED',
      'net::ERR_BLOCKED_BY_CLIENT (blocked: inspector)',
      'canceled'
    ])
    expect(formatNetworkLine(log.get(1)!)).toBe(
      '#1 GET failed (net::ERR_CONNECTION_REFUSED) Fetch http://localhost:9/x · 10 ms'
    )
  })

  test('a redirect closes the hop and starts a new entry', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(sent('r', 'http://localhost/old', { type: 'Document' }))
    log.requestWillBeSent(
      sent('r', 'http://localhost/new', {
        type: 'Document',
        timestamp: 100.02,
        redirectResponse: { status: 302, statusText: 'Found', headers: { Location: '/new' } }
      })
    )
    const [hop, next] = log.query().entries
    expect(hop).toMatchObject({ state: 'done', status: 302, redirectedTo: 'http://localhost/new' })
    expect(next).toMatchObject({ id: 2, state: 'pending', url: 'http://localhost/new' })
    expect(log.isLatestHop(hop)).toBe(false)
    expect(log.isLatestHop(next)).toBe(true)
    expect(formatNetworkLine(hop)).toBe(
      '#1 GET 302 Document http://localhost/old → http://localhost/new · 20 ms'
    )
  })

  test('filters', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(sent('1', 'http://localhost/app.js', { type: 'Script' }))
    log.requestWillBeSent(sent('2', 'http://localhost/api/cart'))
    log.requestWillBeSent(
      sent('3', 'http://localhost/api/order', {
        type: 'XHR',
        request: { url: 'http://localhost/api/order', method: 'POST', headers: {} }
      })
    )
    log.responseReceived({ requestId: '3', response: { status: 500 } })
    log.requestWillBeSent(sent('4', 'http://localhost/logo.png', { type: 'Image' }))
    log.loadingFailed({ requestId: '4', errorText: 'net::ERR_FAILED' })
    const urls = (q: Parameters<NetworkLog['query']>[0]): string[] =>
      log.query(q).entries.map((e) => e.url.replace('http://localhost', ''))
    expect(urls({ type: 'api' })).toEqual(['/api/cart', '/api/order'])
    expect(urls({ type: 'script' })).toEqual(['/app.js'])
    expect(urls({ pattern: 'CART' })).toEqual(['/api/cart'])
    expect(urls({ method: 'post' })).toEqual(['/api/order'])
    expect(urls({ failed: true })).toEqual(['/api/order', '/logo.png'])
    expect(urls({ since: 2 })).toEqual(['/api/order', '/logo.png'])
    expect(log.query({ limit: 1 })).toMatchObject({ matched: 4, entries: [{ id: 4 }] })
  })

  test('keeps the newest entries', () => {
    const log = new NetworkLog(2)
    for (const id of ['a', 'b', 'c']) log.requestWillBeSent(sent(id, `http://x/${id}`))
    expect(log.query().entries.map((e) => e.id)).toEqual([2, 3])
    expect(log.get(1)).toBeNull()
    // Events for a dropped request are ignored.
    log.loadingFinished({ requestId: 'a' })
    expect(log.lastId).toBe(3)
  })

  test('network idle: nothing open, nothing for a moment; stuck requests do not count', () => {
    const log = new NetworkLog()
    expect(log.isIdle(10_000)).toBe(true)
    log.requestWillBeSent(sent('a', 'http://x/a'), 10_000)
    log.requestWillBeSent(sent('poll', 'http://x/poll'), 10_000)
    log.loadingFinished({ requestId: 'a' }, 10_100)
    expect(log.pending(10_100)).toBe(1)
    expect(log.isIdle(10_100 + NETWORK_IDLE_MS)).toBe(false)
    // The long poll has been open for over 10 s.
    expect(log.pending(20_001)).toBe(0)
    expect(log.isIdle(20_001)).toBe(true)
  })

  test('long request bodies are cut', () => {
    const log = new NetworkLog()
    log.requestWillBeSent(
      sent('p', 'http://x/upload', {
        request: {
          url: 'http://x/upload',
          method: 'POST',
          headers: {},
          postData: 'x'.repeat(10_050)
        }
      })
    )
    expect(log.get(1)!.postData).toEndWith('… (cut at 10000 of 10050 characters)')
  })
})

test('redactHeaders hides credentials, whatever their case', () => {
  expect(
    redactHeaders({
      Authorization: 'Bearer abc',
      cookie: 'sid=1',
      'Set-Cookie': 'sid=2',
      'X-Api-Key': 'k',
      Accept: 'text/html'
    })
  ).toEqual({
    Authorization: 'REDACTED',
    cookie: 'REDACTED',
    'Set-Cookie': 'REDACTED',
    'X-Api-Key': 'REDACTED',
    Accept: 'text/html'
  })
})

test('formatBytes', () => {
  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(1234)).toBe('1.2 kB')
  expect(formatBytes(3_400_000)).toBe('3.4 MB')
})

test('formatNetworkDetail shows headers redacted and the request body', () => {
  const log = new NetworkLog()
  log.requestWillBeSent(
    sent('r', 'http://localhost/api/login', {
      request: {
        url: 'http://localhost/api/login',
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
        postData: '{"user":"ada"}'
      }
    })
  )
  log.responseReceived({
    requestId: 'r',
    response: {
      status: 401,
      statusText: 'Unauthorized',
      mimeType: 'application/json',
      headers: { 'set-cookie': 's=1' }
    }
  })
  expect(formatNetworkDetail(log.get(1)!)).toBe(
    [
      '#1 POST http://localhost/api/login',
      '401 Unauthorized · Fetch · application/json',
      'Request headers:',
      '  Authorization: REDACTED',
      '  Content-Type: application/json',
      'Request body:',
      '{"user":"ada"}',
      'Response headers:',
      '  set-cookie: REDACTED'
    ].join('\n')
  )
})
