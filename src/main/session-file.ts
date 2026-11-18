import { isHomeUrl } from '../shared/url'
import { cleanTitle, isBookmarkableUrl } from './bookmark-list'

/** More tabs than this aren't brought back (the first ones are). */
export const MAX_SESSION_TABS = 100

const FILE_VERSION = 1

/** One tab as it's saved: where it was, and what its tab said. */
export interface SavedTab {
  url: string
  title: string
}

/** The tabs that were open, in strip order, and which one was in front. */
export interface SavedSession {
  tabs: SavedTab[]
  /** An index into `tabs` (0 when there are none). */
  active: number
}

export const EMPTY_SESSION: SavedSession = { tabs: [], active: 0 }

/** Only pages main loads itself come back: the web (http(s)) and the start page. */
export function isRestorableUrl(url: string): boolean {
  return isHomeUrl(url) || isBookmarkableUrl(url)
}

function parseTab(raw: unknown): SavedTab | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { url, title } = raw as Record<string, unknown>
  if (typeof url !== 'string' || !isRestorableUrl(url)) return null
  return { url, title: cleanTitle(typeof title === 'string' ? title : '', url) }
}

/**
 * Reads session.json as parsed JSON. It's a file anyone can edit, so it's never trusted: tabs
 * with other URLs are dropped (the tab in front moves with them), and a foreign file is empty.
 */
export function parseSessionFile(raw: unknown): SavedSession {
  if (typeof raw !== 'object' || raw === null) return EMPTY_SESSION
  const { version, tabs, active } = raw as Record<string, unknown>
  if (version !== FILE_VERSION || !Array.isArray(tabs)) return EMPTY_SESSION
  const wanted = typeof active === 'number' && Number.isInteger(active) ? active : 0
  const kept: SavedTab[] = []
  let front = 0
  tabs.slice(0, MAX_SESSION_TABS).forEach((entry, index) => {
    const tab = parseTab(entry)
    if (!tab) return
    if (index === wanted) front = kept.length
    kept.push(tab)
  })
  return kept.length === 0 ? EMPTY_SESSION : { tabs: kept, active: front }
}

export function toSessionFile(session: SavedSession): unknown {
  return { version: FILE_VERSION, tabs: session.tabs, active: session.active }
}

/** The session to save for these tabs: only the ones that can come back. */
export function sessionOf(tabs: readonly SavedTab[], active: number): SavedSession {
  return parseSessionFile({ version: FILE_VERSION, tabs, active })
}

/** A lone start page is what a launch opens anyway: nothing to bring back. */
export function isWorthRestoring(session: SavedSession): boolean {
  return session.tabs.length > 1 || (session.tabs.length === 1 && !isHomeUrl(session.tabs[0].url))
}
