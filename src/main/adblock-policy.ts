import type { ShieldStatus } from '../shared/types'
import { isHttpUrl } from '../shared/url'

/** The filter lists are downloaded again once they are this old. */
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000
/** After a failed download, the next try waits at least this long. */
export const RETRY_INTERVAL_MS = 15 * 60 * 1000
/** At most this many sites can be paused (settings.json is checked against it). */
export const MAX_PAUSED_SITES = 1000

const MAX_HOSTNAME_LENGTH = 253

const UBLOCK = 'https://ublockorigin.github.io/uAssets/filters'

/** The filter lists, from where their authors publish them: ads, trackers, malware. */
export const FILTER_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext',
  ...[
    'filters',
    'filters-2020',
    'filters-2021',
    'filters-2022',
    'filters-2023',
    'filters-2024',
    'filters-2025',
    'filters-2026',
    'badware',
    'privacy',
    'quick-fixes',
    'resource-abuse',
    'unbreak'
  ].map((name) => `${UBLOCK}/${name}.txt`)
]

/**
 * The site a page belongs to, as the ad blocker's "pause on this site" sees it: the hostname
 * without a leading "www.". Null for pages that aren't on the web.
 */
export function siteOf(url: string): string | null {
  if (!isHttpUrl(url)) return null
  try {
    const { hostname } = new URL(url)
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return null
  }
}

/** Whether `value` is something siteOf returns (used to check settings.json). */
export function isSite(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_HOSTNAME_LENGTH &&
    siteOf(`https://${value}/`) === value
  )
}

/** Pauses blocking on `site`, or resumes it. Returns a new list. */
export function togglePausedSite(sites: readonly string[], site: string): string[] {
  return sites.includes(site) ? sites.filter((other) => other !== site) : [...sites, site]
}

/** Where the filter engine is: none yet (downloading, or failed), or loaded. */
export type EngineStatus = 'loading' | 'ready' | 'failed'

/** What the shield in the address bar shows. */
export function shieldStatus({
  enabled,
  paused,
  engine
}: {
  enabled: boolean
  paused: boolean
  engine: EngineStatus
}): ShieldStatus {
  if (!enabled) return 'off'
  if (paused) return 'paused'
  if (engine === 'ready') return 'on'
  return engine === 'loading' ? 'loading' : 'unavailable'
}

/**
 * Whether to download the filter lists now: when there are none yet or they're a day old,
 * but not again within RETRY_INTERVAL_MS of the last try. Times are in ms since the epoch
 * (null: never). A last update in the future means the clock changed, so it's due too.
 */
export function isUpdateDue({
  lastUpdated,
  lastAttempt,
  now
}: {
  lastUpdated: number | null
  lastAttempt: number | null
  now: number
}): boolean {
  if (lastAttempt !== null && now - lastAttempt < RETRY_INTERVAL_MS && now >= lastAttempt) {
    return false
  }
  return lastUpdated === null || now - lastUpdated >= UPDATE_INTERVAL_MS || now < lastUpdated
}

/** Class names and ids found in a page, for the engine's generic element-hiding rules. */
export interface DomTokens {
  classes: string[]
  ids: string[]
}

const MAX_TOKENS = 5000
const MAX_TOKEN_LENGTH = 2048

/**
 * Checks what the page scan (in adblock.ts) returned. It runs inside the page, so the result is
 * only trusted as far as this: lists of strings, capped in count and length.
 */
export function parseDomTokens(raw: unknown): DomTokens {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.length > 0 && item.length <= MAX_TOKEN_LENGTH
          )
          .slice(0, MAX_TOKENS)
      : []
  return { classes: list(input.classes), ids: list(input.ids) }
}

/** What a page has already been scanned for; see takeUnseen. */
export interface SeenTokens {
  classes: Set<string>
  ids: Set<string>
}

export function emptySeenTokens(): SeenTokens {
  return { classes: new Set(), ids: new Set() }
}

/** The tokens not in `seen` yet, which are added to it. Null when there's nothing new. */
export function takeUnseen(seen: SeenTokens, found: DomTokens): DomTokens | null {
  const unseen = (known: Set<string>, items: string[]): string[] => {
    const fresh = items.filter((item) => !known.has(item))
    for (const item of fresh) known.add(item)
    return fresh
  }
  const tokens = {
    classes: unseen(seen.classes, found.classes),
    ids: unseen(seen.ids, found.ids)
  }
  return tokens.classes.length + tokens.ids.length === 0 ? null : tokens
}
