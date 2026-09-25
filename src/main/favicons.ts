import { net } from 'electron'
import { sniffImageType } from './image-type'

const MAX_BYTES = 256 * 1024
const TIMEOUT_MS = 10_000
const CACHE_SIZE = 200

// Favicon URL -> data: URL, or null when it couldn't be used. Oldest entries are evicted first.
const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

/**
 * Fetches a page's favicon in main and returns it as a data: URL, so the UI can show it
 * without loading anything from the web (its CSP only allows 'self' and data: images).
 * Only http(s) and data: URLs are used; the bytes must be a recognised image under 256 KB.
 */
export function loadFavicon(url: string): Promise<string | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null)
  const inFlight = pending.get(url)
  if (inFlight) return inFlight

  const request = fetchAsDataUrl(url)
    .catch(() => null)
    .then((result) => {
      pending.delete(url)
      cache.set(url, result)
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
      return result
    })
  pending.set(url, request)
  return request
}

/** The first favicon candidate we're willing to fetch. */
export function pickFaviconUrl(candidates: readonly string[]): string | null {
  return candidates.find((url) => /^(https?:|data:image\/)/i.test(url)) ?? null
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  const protocol = new URL(url).protocol
  let response: Response
  if (protocol === 'data:') {
    if (url.length > MAX_BYTES * 2) return null
    // Node's fetch decodes data: URLs locally; nothing goes over the network.
    response = await fetch(url)
  } else if (protocol === 'http:' || protocol === 'https:') {
    response = await net.fetch(url, {
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } else {
    return null
  }
  if (!response.ok) return null

  const body = await readCapped(response)
  if (!body) return null
  const mimeType = sniffImageType(body)
  if (!mimeType) return null
  return `data:${mimeType};base64,${Buffer.from(body).toString('base64')}`
}

/** Reads the body, giving up as soon as it passes MAX_BYTES. */
async function readCapped(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > MAX_BYTES || !response.body) return null

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return size === 0 ? null : Buffer.concat(chunks)
}
