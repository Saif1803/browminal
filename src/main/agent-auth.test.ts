import { describe, expect, test } from 'bun:test'
import {
  checkAgentRequest,
  isAgentToken,
  newAgentToken,
  parseAgentFile,
  toAgentFile
} from './agent-auth'

const PORT = 9339
const TOKEN = newAgentToken()
const ok = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` }

describe('checkAgentRequest', () => {
  test('lets in a request with the token, addressed to loopback on our port', () => {
    expect(checkAgentRequest(ok, PORT, TOKEN)).toBe('ok')
    expect(checkAgentRequest({ ...ok, host: `localhost:${PORT}` }, PORT, TOKEN)).toBe('ok')
    expect(checkAgentRequest({ ...ok, host: `LOCALHOST:${PORT}` }, PORT, TOKEN)).toBe('ok')
  })

  test('refuses other host names, so DNS rebinding gets nowhere', () => {
    for (const host of [
      undefined,
      '',
      'evil.example',
      `evil.example:${PORT}`,
      `127.0.0.1:${PORT + 1}`,
      '127.0.0.1',
      `127.0.0.1.nip.io:${PORT}`,
      `[::1]:${PORT}`
    ]) {
      expect(checkAgentRequest({ ...ok, host }, PORT, TOKEN)).toBe('bad-host')
    }
  })

  test('refuses anything a browser sent, even with the right token', () => {
    expect(checkAgentRequest({ ...ok, origin: 'https://evil.example' }, PORT, TOKEN)).toBe(
      'from-browser'
    )
    expect(checkAgentRequest({ ...ok, origin: 'null' }, PORT, TOKEN)).toBe('from-browser')
    expect(checkAgentRequest({ ...ok, origin: '' }, PORT, TOKEN)).toBe('from-browser')
    expect(checkAgentRequest({ ...ok, secFetchSite: 'cross-site' }, PORT, TOKEN)).toBe(
      'from-browser'
    )
  })

  test('refuses a missing or wrong token', () => {
    const check = (authorization: string | undefined): string =>
      checkAgentRequest({ ...ok, authorization }, PORT, TOKEN)
    expect(check(undefined)).toBe('unauthorized')
    expect(check('')).toBe('unauthorized')
    expect(check(TOKEN)).toBe('unauthorized')
    expect(check(`Basic ${TOKEN}`)).toBe('unauthorized')
    expect(check(`Bearer ${newAgentToken()}`)).toBe('unauthorized')
    expect(check(`Bearer ${TOKEN.slice(0, -1)}`)).toBe('unauthorized')
    expect(check(`Bearer ${TOKEN}x`)).toBe('unauthorized')
    expect(check(`Bearer ${TOKEN} extra`)).toBe('unauthorized')
  })
})

describe('agent.json', () => {
  test('new tokens are distinct 32-byte base64url strings', () => {
    const a = newAgentToken()
    expect(isAgentToken(a)).toBe(true)
    expect(a).not.toBe(newAgentToken())
  })

  test('keeps a saved token and replaces anything else', () => {
    expect(parseAgentFile(toAgentFile({ token: TOKEN }))).toEqual({ token: TOKEN })
    for (const raw of [undefined, null, 'x', [], { token: 'short' }, { token: 42 }]) {
      const { token } = parseAgentFile(raw)
      expect(isAgentToken(token)).toBe(true)
      expect(token).not.toBe(TOKEN)
    }
  })
})
