import { randomBytes, timingSafeEqual } from 'crypto'

/** 32 random bytes in base64url. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** The headers of a request to the agent server that decide whether it's let in. */
export interface AgentRequestHeaders {
  host?: string
  origin?: string
  authorization?: string
  /** Sent by browsers (fetch, forms, navigations); terminal agents don't send it. */
  secFetchSite?: string
}

/**
 * - ok: let in, with `token` the one of the given tokens it carried
 * - bad-host: not addressed to 127.0.0.1/localhost on our port (a DNS rebinding attempt)
 * - from-browser: sent by a web page; no page may talk to the agent server, not even ours
 * - unauthorized: no token, or a wrong one
 */
export type AgentRequestCheck =
  { result: 'ok'; token: string } | { result: 'bad-host' | 'from-browser' | 'unauthorized' }

export function newAgentToken(): string {
  return randomBytes(32).toString('base64url')
}

export const isAgentToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN_PATTERN.test(value)

/**
 * Checks a request in this order: where it's addressed, who sent it, then the token, which must
 * be one of `tokens` (the bridge's own, and one per agent started in a Browminal terminal).
 */
export function checkAgentRequest(
  headers: AgentRequestHeaders,
  port: number,
  tokens: readonly string[]
): AgentRequestCheck {
  const host = headers.host?.toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return { result: 'bad-host' }
  if (headers.origin !== undefined || headers.secFetchSite !== undefined) {
    return { result: 'from-browser' }
  }
  const match = /^Bearer (\S+)$/.exec(headers.authorization ?? '')
  if (!match) return { result: 'unauthorized' }
  const given = Buffer.from(match[1])
  // Compare in constant time, so a token can't be guessed a character at a time.
  const token = tokens.find((token) => {
    const expected = Buffer.from(token)
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
  return token === undefined ? { result: 'unauthorized' } : { result: 'ok', token }
}

/** agent.json: the token agents connect with. */
export interface AgentFile {
  token: string
}

/** Reads agent.json as parsed JSON; anything unusable gets a fresh token. */
export function parseAgentFile(raw: unknown): AgentFile {
  const token = (raw as { token?: unknown } | null)?.token
  return { token: isAgentToken(token) ? token : newAgentToken() }
}

export const toAgentFile = ({ token }: AgentFile): unknown => ({ version: 1, token })
