/**
 * A tab's network requests as agents read them, built from the CDP Network domain's events, from
 * the moment the tab was shared. Pure: events come in as plain objects. Credentials in headers
 * (Authorization, cookies) are never shown; bodies are fetched by the tool, not kept here.
 */

export const MAX_NETWORK_ENTRIES = 500
const MAX_POST_DATA = 10_000
const MAX_URL_IN_LIST = 300
/** wait_for(networkIdle): this long with nothing starting or finishing. */
export const NETWORK_IDLE_MS = 500
/** Requests open longer than this (long-polling, streams) don't keep the network busy. */
const STUCK_REQUEST_MS = 10_000

export const REDACTED = 'REDACTED'
const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token'
])

export type NetworkState = 'pending' | 'done' | 'failed'

export interface NetworkEntry {
  /** Grows by one per request, across the tab's whole log: the id network_request takes. */
  id: number
  /** Chromium's id: response bodies are fetched with it. */
  requestId: string
  method: string
  url: string
  /** Document, Script, Fetch, XHR, Image… */
  type: string
  state: NetworkState
  status: number | null
  statusText: string
  mimeType: string
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string> | null
  /** Capped; null when there was none (or Chromium didn't include it). */
  postData: string | null
  /** ms since the epoch, when it started. */
  startTime: number
  durationMs: number | null
  /** Bytes over the wire, when it finished. */
  size: number | null
  fromCache: boolean
  error: string | null
  /** Set on a redirect hop: where it went next. */
  redirectedTo: string | null
  /** Monotonic seconds from CDP, for the duration. */
  startStamp: number
  /** When it last started or finished (caller's clock, ms), for network idle. */
  touched: number
}

type Params = Record<string, unknown>

const asRecord = (value: unknown): Params =>
  value !== null && typeof value === 'object' ? (value as Params) : {}

function headersOf(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, raw] of Object.entries(asRecord(value))) headers[name] = String(raw)
  return headers
}

/** Headers with credentials replaced by REDACTED. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADERS.has(name.toLowerCase()) ? REDACTED : value
  }
  return out
}

export interface NetworkQuery {
  /** Only URLs containing this (case-insensitive). */
  pattern?: string
  /** Only this resource type (Fetch, XHR, Script…; case-insensitive). "api" means Fetch and XHR. */
  type?: string
  method?: string
  /** Only failed requests and HTTP errors (status 400 and up). */
  failed?: boolean
  /** Only requests after this id. */
  since?: number
  /** The newest this many (default 50). */
  limit?: number
}

export class NetworkLog {
  private entries: NetworkEntry[] = []
  private readonly byRequestId = new Map<string, NetworkEntry>()
  private nextId = 1
  private lastActivity = 0

  constructor(private readonly max = MAX_NETWORK_ENTRIES) {}

  get lastId(): number {
    return this.nextId - 1
  }

  /** Network.requestWillBeSent. A redirect closes the previous hop and starts a new entry. */
  requestWillBeSent(params: Params, now = Date.now()): void {
    const requestId = String(params.requestId ?? '')
    const request = asRecord(params.request)
    const stamp = Number(params.timestamp ?? 0)
    const previous = this.byRequestId.get(requestId)
    if (previous && params.redirectResponse) {
      const response = asRecord(params.redirectResponse)
      previous.state = 'done'
      previous.status = Number(response.status ?? 0) || null
      previous.statusText = String(response.statusText ?? '')
      previous.responseHeaders = headersOf(response.headers)
      previous.durationMs = Math.max(0, (stamp - previous.startStamp) * 1000)
      previous.redirectedTo = String(request.url ?? '')
      previous.touched = now
    }
    const postData = typeof request.postData === 'string' ? request.postData : null
    const entry: NetworkEntry = {
      id: this.nextId++,
      requestId,
      method: String(request.method ?? 'GET'),
      url: String(request.url ?? ''),
      type: String(params.type ?? 'Other'),
      state: 'pending',
      status: null,
      statusText: '',
      mimeType: '',
      requestHeaders: headersOf(request.headers),
      responseHeaders: null,
      postData:
        postData === null
          ? null
          : postData.length > MAX_POST_DATA
            ? `${postData.slice(0, MAX_POST_DATA)} … (cut at ${MAX_POST_DATA} of ${postData.length} characters)`
            : postData,
      startTime: Number(params.wallTime ?? now / 1000) * 1000,
      durationMs: null,
      size: null,
      fromCache: false,
      error: null,
      redirectedTo: null,
      startStamp: stamp,
      touched: now
    }
    this.entries.push(entry)
    this.byRequestId.set(requestId, entry)
    this.lastActivity = now
    if (this.entries.length > this.max) {
      for (const old of this.entries.splice(0, this.entries.length - this.max)) {
        if (this.byRequestId.get(old.requestId) === old) this.byRequestId.delete(old.requestId)
      }
    }
  }

  /** Network.responseReceived. */
  responseReceived(params: Params): void {
    const entry = this.byRequestId.get(String(params.requestId ?? ''))
    if (!entry) return
    const response = asRecord(params.response)
    entry.status = Number(response.status ?? 0) || null
    entry.statusText = String(response.statusText ?? '')
    entry.mimeType = String(response.mimeType ?? '')
    entry.responseHeaders = headersOf(response.headers)
    entry.fromCache = Boolean(response.fromDiskCache || response.fromPrefetchCache)
    if (typeof params.type === 'string') entry.type = params.type
  }

  /** Network.loadingFinished. */
  loadingFinished(params: Params, now = Date.now()): void {
    const entry = this.byRequestId.get(String(params.requestId ?? ''))
    if (!entry || entry.state !== 'pending') return
    entry.state = 'done'
    entry.size = Number(params.encodedDataLength ?? 0)
    entry.durationMs = Math.max(0, (Number(params.timestamp ?? 0) - entry.startStamp) * 1000)
    entry.touched = now
    this.lastActivity = now
  }

  /** Network.loadingFailed: refused, blocked (by the ad blocker too), cancelled, timed out. */
  loadingFailed(params: Params, now = Date.now()): void {
    const entry = this.byRequestId.get(String(params.requestId ?? ''))
    if (!entry || entry.state !== 'pending') return
    entry.state = 'failed'
    const reason = params.blockedReason ? ` (blocked: ${String(params.blockedReason)})` : ''
    entry.error = params.canceled ? 'canceled' : `${String(params.errorText ?? 'failed')}${reason}`
    entry.durationMs = Math.max(0, (Number(params.timestamp ?? 0) - entry.startStamp) * 1000)
    entry.touched = now
    this.lastActivity = now
  }

  get(id: number): NetworkEntry | null {
    return this.entries.find((entry) => entry.id === id) ?? null
  }

  /** The entry Chromium still has the body of: the last hop of its request. */
  isLatestHop(entry: NetworkEntry): boolean {
    return this.byRequestId.get(entry.requestId) === entry
  }

  clear(): void {
    this.entries = []
    this.byRequestId.clear()
  }

  /** Requests still open, not counting ones stuck open for a long time (streams, long-polling). */
  pending(now = Date.now()): number {
    return this.entries.filter(
      (entry) => entry.state === 'pending' && now - entry.touched < STUCK_REQUEST_MS
    ).length
  }

  /** Nothing open (but stuck requests) and nothing started or finished for NETWORK_IDLE_MS. */
  isIdle(now = Date.now()): boolean {
    return this.pending(now) === 0 && now - this.lastActivity >= NETWORK_IDLE_MS
  }

  query({ pattern, type, method, failed, since = 0, limit = 50 }: NetworkQuery = {}): {
    entries: NetworkEntry[]
    matched: number
  } {
    const needle = pattern?.toLowerCase()
    const kind = type?.toLowerCase()
    const verb = method?.toUpperCase()
    const matches = this.entries.filter(
      (entry) =>
        entry.id > since &&
        (!needle || entry.url.toLowerCase().includes(needle)) &&
        (!kind ||
          entry.type.toLowerCase() === kind ||
          (kind === 'api' && (entry.type === 'Fetch' || entry.type === 'XHR'))) &&
        (!verb || entry.method === verb) &&
        (!failed || entry.state === 'failed' || (entry.status ?? 0) >= 400)
    )
    return { entries: matches.slice(-limit), matched: matches.length }
  }
}

/** 512 B, 1.2 kB, 3.4 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

const formatDuration = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`

const shortUrl = (url: string): string =>
  url.length <= MAX_URL_IN_LIST ? url : `${url.slice(0, MAX_URL_IN_LIST)}…`

function outcome(entry: NetworkEntry): string {
  if (entry.state === 'failed') return `failed (${entry.error})`
  if (entry.status === null) return 'pending'
  return String(entry.status)
}

/** One line per request for network_requests. */
export function formatNetworkLine(entry: NetworkEntry): string {
  const parts = [
    `#${entry.id} ${entry.method} ${outcome(entry)} ${entry.type} ${shortUrl(entry.url)}`
  ]
  if (entry.redirectedTo) parts[0] += ` → ${shortUrl(entry.redirectedTo)}`
  if (entry.size !== null) parts.push(entry.fromCache ? 'cache' : formatBytes(entry.size))
  if (entry.durationMs !== null) parts.push(formatDuration(entry.durationMs))
  return parts.join(' · ')
}

const headerLines = (headers: Record<string, string>): string =>
  Object.entries(redactHeaders(headers))
    .map(([name, value]) => `  ${name}: ${value}`)
    .join('\n') || '  (none)'

/** network_request's reply, without the response body (the tool adds it). */
export function formatNetworkDetail(entry: NetworkEntry): string {
  const facts = [
    entry.state === 'failed'
      ? `failed: ${entry.error}`
      : entry.status === null
        ? 'pending'
        : `${entry.status}${entry.statusText ? ` ${entry.statusText}` : ''}`,
    entry.type,
    entry.mimeType,
    entry.size !== null && (entry.fromCache ? 'from cache' : formatBytes(entry.size)),
    entry.durationMs !== null && formatDuration(entry.durationMs)
  ].filter(Boolean)
  const lines = [`#${entry.id} ${entry.method} ${entry.url}`, facts.join(' · ')]
  if (entry.redirectedTo) lines.push(`Redirected to ${entry.redirectedTo}`)
  lines.push('Request headers:', headerLines(entry.requestHeaders))
  if (entry.postData !== null) lines.push('Request body:', entry.postData)
  if (entry.responseHeaders) lines.push('Response headers:', headerLines(entry.responseHeaders))
  return lines.join('\n')
}
