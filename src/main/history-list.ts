import type { Bookmark } from '../shared/types'
import { cleanTitle, isBookmarkableUrl } from './bookmark-list'

/** The oldest pages are forgotten beyond this many. */
export const MAX_HISTORY = 2000
/** URLs longer than this aren't remembered (they're tracking links, not places to go back to). */
export const MAX_HISTORY_URL = 2048
export const MAX_SUGGESTIONS = 6

const FILE_VERSION = 1
const DAY_MS = 24 * 60 * 60 * 1000

/** One page the user visited. The list is kept newest first. */
export interface HistoryEntry {
  url: string
  title: string
  /** When it was last opened (ms since 1970). */
  lastVisit: number
  visits: number
}

/** A page offered under the address bar while the user types. */
export interface Suggestion {
  url: string
  title: string
  bookmark: boolean
}

export function isHistoryUrl(url: string): boolean {
  return url.length <= MAX_HISTORY_URL && isBookmarkableUrl(url)
}

function parseEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { url, title, lastVisit, visits } = raw as Record<string, unknown>
  if (typeof url !== 'string' || !isHistoryUrl(url)) return null
  if (typeof lastVisit !== 'number' || !Number.isFinite(lastVisit) || lastVisit < 0) return null
  return {
    url,
    title: cleanTitle(typeof title === 'string' ? title : '', url),
    lastVisit,
    visits: typeof visits === 'number' && Number.isSafeInteger(visits) && visits > 0 ? visits : 1
  }
}

/**
 * Reads history.json as parsed JSON, never trusting it: entries that aren't http(s) pages are
 * dropped, a URL listed twice counts once, and the list comes back newest first.
 */
export function parseHistoryFile(raw: unknown): HistoryEntry[] {
  if (typeof raw !== 'object' || raw === null) return []
  const { version, entries } = raw as Record<string, unknown>
  if (version !== FILE_VERSION || !Array.isArray(entries)) return []
  const seen = new Set<string>()
  const kept: HistoryEntry[] = []
  for (const item of entries) {
    const entry = parseEntry(item)
    if (!entry || seen.has(entry.url)) continue
    seen.add(entry.url)
    kept.push(entry)
  }
  return kept.sort((a, b) => b.lastVisit - a.lastVisit).slice(0, MAX_HISTORY)
}

export function toHistoryFile(entries: readonly HistoryEntry[]): unknown {
  return { version: FILE_VERSION, entries }
}

/** `url` was opened at `now`: it goes to the front, counted once more. Other URLs are ignored. */
export function recordVisit(
  entries: readonly HistoryEntry[],
  url: string,
  title: string,
  now: number
): readonly HistoryEntry[] {
  if (!isHistoryUrl(url)) return entries
  const before = entries.find((entry) => entry.url === url)
  const entry: HistoryEntry = {
    url,
    // A page that hasn't said its title yet keeps the one it had.
    title: title.trim() || !before ? cleanTitle(title, url) : before.title,
    lastVisit: now,
    visits: (before?.visits ?? 0) + 1
  }
  return [entry, ...entries.filter((other) => other !== before)].slice(0, MAX_HISTORY)
}

/** The page at `url` said its title; nothing changes if it isn't in the history. */
export function retitle(
  entries: readonly HistoryEntry[],
  url: string,
  title: string
): readonly HistoryEntry[] {
  const index = entries.findIndex((entry) => entry.url === url)
  if (index === -1 || !title.trim()) return entries
  const cleaned = cleanTitle(title, url)
  if (entries[index].title === cleaned) return entries
  return entries.map((entry, i) => (i === index ? { ...entry, title: cleaned } : entry))
}

/** A URL as it's matched against what the user types: no scheme, no "www.". */
function bare(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
}

/**
 * Pages to offer for what's typed in the address bar, best first. Every word typed must be in
 * the page's address or title. A page whose address starts with what's typed comes before the
 * rest; then bookmarks, pages opened often, and pages opened lately.
 */
export function suggest(
  query: string,
  history: readonly HistoryEntry[],
  bookmarks: readonly Bookmark[],
  now: number,
  limit = MAX_SUGGESTIONS
): Suggestion[] {
  const words = bare(query.trim()).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const visited = new Map(history.map((entry) => [entry.url, entry]))
  const candidates = new Map<string, Suggestion & { visits: number; lastVisit: number }>()
  for (const { url, title } of bookmarks) {
    const seen = visited.get(url)
    candidates.set(url, {
      url,
      title,
      bookmark: true,
      visits: seen?.visits ?? 0,
      lastVisit: seen?.lastVisit ?? 0
    })
  }
  for (const entry of history) {
    if (!candidates.has(entry.url)) candidates.set(entry.url, { ...entry, bookmark: false })
  }

  const scored: { suggestion: Suggestion; score: number; lastVisit: number }[] = []
  for (const candidate of candidates.values()) {
    const address = bare(candidate.url)
    const title = candidate.title.toLowerCase()
    let score = 0
    let matched = true
    for (const word of words) {
      const inAddress = address.includes(word)
      const inTitle = title.includes(word)
      if (!inAddress && !inTitle) {
        matched = false
        break
      }
      score += (inAddress ? 20 : 0) + (inTitle ? 10 : 0)
    }
    if (!matched) continue
    if (address.startsWith(words[0])) score += 100
    if (candidate.bookmark) score += 25
    score += Math.min(candidate.visits, 30)
    if (candidate.lastVisit > 0) {
      score += Math.max(0, 20 - Math.floor((now - candidate.lastVisit) / DAY_MS))
    }
    const { url, title: shown, bookmark } = candidate
    scored.push({
      suggestion: { url, title: shown, bookmark },
      score,
      lastVisit: candidate.lastVisit
    })
  }
  return scored
    .sort((a, b) => b.score - a.score || b.lastVisit - a.lastVisit)
    .slice(0, limit)
    .map(({ suggestion }) => suggestion)
}
