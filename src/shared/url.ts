export const SEARCH_URL = 'https://duckduckgo.com/?q='
export const HOME_URL = 'https://duckduckgo.com/'

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i
const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d{1,5})?([/?#].*)?$/i
// host.tld with optional port and path; the TLD must be letters (2+) so "3.14" stays a search.
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}\.?(:\d{1,5})?([/?#].*)?$/i

/**
 * Turns address-bar text into a URL to load.
 * - http(s) URLs are used as-is.
 * - Bare hostnames get https://, except localhost and IPs, which get http://.
 * - Everything else (including other schemes like javascript: or file:) is a DuckDuckGo search.
 */
export function resolveInput(raw: string): string {
  const input = raw.trim()
  if (!input) return HOME_URL

  const scheme = SCHEME.exec(input)?.[1]?.toLowerCase()
  if (scheme === 'http' || scheme === 'https') {
    if (isValidUrl(input)) return input
  } else if (!scheme && !/\s/.test(input)) {
    if (LOCAL_HOST.test(input) && isValidUrl(`http://${input}`)) return `http://${input}`
    if (DOMAIN.test(input) && isValidUrl(`https://${input}`)) return `https://${input}`
  }

  return SEARCH_URL + encodeURIComponent(input)
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}
