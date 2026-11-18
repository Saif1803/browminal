/** The search engines the address bar can use (Settings → Search with). */
export const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' }
} as const

export type SearchEngine = keyof typeof SEARCH_ENGINES

export const isSearchEngine = (value: unknown): value is SearchEngine =>
  typeof value === 'string' && Object.hasOwn(SEARCH_ENGINES, value)

/** The default engine's search URL; the query goes at its end. */
export const SEARCH_URL = SEARCH_ENGINES.google.url

/** Scheme for the browser's own pages, served from resources/ by src/main/protocol.ts. */
export const INTERNAL_SCHEME = 'browminal'
export const HOME_URL = `${INTERNAL_SCHEME}://home/`

export const ERROR_URL = `${INTERNAL_SCHEME}://error/`

export function isHomeUrl(url: string): boolean {
  return url === HOME_URL || url.startsWith(`${HOME_URL}#`) || url.startsWith(`${HOME_URL}?`)
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** The page shown when a page fails to load; `code` is the net error name, e.g. ERR_NAME_NOT_RESOLVED. */
export function errorPageUrl(code: string, failedUrl: string): string {
  const query = new URLSearchParams({ code, url: failedUrl })
  return `${ERROR_URL}?${query}`
}

/** The error code and the http(s) URL that failed, if `url` is an error page. */
export function parseErrorPageUrl(url: string): { code: string; url: string } | null {
  if (!url.startsWith(`${ERROR_URL}?`)) return null
  const query = new URLSearchParams(url.slice(ERROR_URL.length + 1).split('#')[0])
  const failedUrl = query.get('url') ?? ''
  if (!isHttpUrl(failedUrl)) return null
  return { code: query.get('code') ?? '', url: failedUrl }
}

/** What the address bar shows for a tab: an error page shows the URL that failed. */
export function displayUrl(url: string): string {
  return parseErrorPageUrl(url)?.url ?? url
}

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i
const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d{1,5})?([/?#].*)?$/i
// host.tld with optional port and path; the TLD must be letters (2+) so "3.14" stays a search.
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}\.?(:\d{1,5})?([/?#].*)?$/i

/**
 * Turns address-bar text into a URL to load.
 * - http(s) URLs are used as-is.
 * - Bare hostnames get https://, except localhost and IPs, which get http://.
 * - Everything else (including other schemes like javascript: or file:) is a search, with the
 *   engine whose URL is `searchUrl` (Google unless the user chose another).
 * - Empty input goes to the home page.
 */
export function resolveInput(raw: string, searchUrl: string = SEARCH_URL): string {
  const input = raw.trim()
  if (!input) return HOME_URL

  const scheme = SCHEME.exec(input)?.[1]?.toLowerCase()
  if (scheme === 'http' || scheme === 'https') {
    if (isValidUrl(input)) return input
  } else if (!scheme && !/\s/.test(input)) {
    if (LOCAL_HOST.test(input) && isValidUrl(`http://${input}`)) return `http://${input}`
    if (DOMAIN.test(input) && isValidUrl(`https://${input}`)) return `https://${input}`
  }

  return searchUrl + encodeURIComponent(input)
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}
