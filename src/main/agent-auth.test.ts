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
const TOKENS = [TOKEN]
const ok = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` }
/** The result alone. */
const check = (headers: Parameters<typeof checkAgentRequest>[0], tokens = TOKENS): string =>
  checkAgentRequest(headers, PORT, tokens).result

describe('checkAgentRequest', () => {
  test('lets in a request with the token, addressed to loopback on our port', () => {
    expect(checkAgentRequest(ok, PORT, TOKENS)).toEqual({ result: 'ok', token: TOKEN })
    expect(check({ ...ok, host: `localhost:${PORT}` })).toBe('ok')
    expect(check({ ...ok, host: `LOCALHOST:${PORT}` })).toBe('ok')
  })

  test('says which of the tokens the request carried', () => {
    const session = newAgentToken()
    const withSession = { ...ok, authorization: `Bearer ${session}` }
    expect(checkAgentRequest(withSession, PORT, [TOKEN, session])).toEqual({
      result: 'ok',
      token: session
    })
    expect(check(withSession)).toBe('unauthorized')
    expect(check(ok, [])).toBe('unauthorized')
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
      expect(check({ ...ok, host })).toBe('bad-host')
    }
  })

  test('refuses anything a browser sent, even with the right token', () => {
    expect(check({ ...ok, origin: 'https://evil.example' })).toBe('from-browser')
    expect(check({ ...ok, origin: 'null' })).toBe('from-browser')
    expect(check({ ...ok, origin: '' })).toBe('from-browser')
    expect(check({ ...ok, secFetchSite: 'cross-site' })).toBe('from-browser')
  })

  test('refuses a missing or wrong token', () => {
    const withAuth = (authorization: string | undefined): string => check({ ...ok, authorization })
    expect(withAuth(undefined)).toBe('unauthorized')
    expect(withAuth('')).toBe('unauthorized')
    expect(withAuth(TOKEN)).toBe('unauthorized')
    expect(withAuth(`Basic ${TOKEN}`)).toBe('unauthorized')
    expect(withAuth(`Bearer ${newAgentToken()}`)).toBe('unauthorized')
    expect(withAuth(`Bearer ${TOKEN.slice(0, -1)}`)).toBe('unauthorized')
    expect(withAuth(`Bearer ${TOKEN}x`)).toBe('unauthorized')
    expect(withAuth(`Bearer ${TOKEN} extra`)).toBe('unauthorized')
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
