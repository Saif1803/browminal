import type { Bookmark } from '../shared/types'
import { isHttpUrl } from '../shared/url'

export const MAX_BOOKMARKS = 5000
export const MAX_URL_LENGTH = 8192
export const MAX_TITLE_LENGTH = 300
/** Bookmarks keep small icons; anything bigger is dropped (the tab still shows the live one). */
export const MAX_FAVICON_LENGTH = 64 * 1024

const FILE_VERSION = 1
// The formats favicons.ts accepts, base64-encoded as it makes them.
const FAVICON_DATA_URL =
  /^data:image\/(png|x-icon|jpeg|gif|webp|bmp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/

/** What a new bookmark is made from: the page as the tab shows it. */
export interface NewBookmark {
  url: string
  title: string
  favicon: string | null
}

/** On disk: a version, so a later format can tell old files apart. */
interface BookmarkFile {
  version: typeof FILE_VERSION
  bookmarks: Bookmark[]
}

export function isBookmarkableUrl(url: string): boolean {
  if (!isHttpUrl(url) || url.length > MAX_URL_LENGTH) return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export function isFaviconDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_FAVICON_LENGTH && FAVICON_DATA_URL.test(value)
  )
}

/** One line, trimmed, at most MAX_TITLE_LENGTH characters; the URL when there's no title. */
export function cleanTitle(title: string, url: string): string {
  const text = title.replace(/\s+/g, ' ').trim()
  if (!text) return url.slice(0, MAX_TITLE_LENGTH)
  return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}…` : text
}

function parseBookmark(raw: unknown): Bookmark | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, url, title, favicon } = raw as Record<string, unknown>
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return null
  if (typeof url !== 'string' || !isBookmarkableUrl(url)) return null
  return {
    id,
    url,
    title: cleanTitle(typeof title === 'string' ? title : '', url),
    favicon: isFaviconDataUrl(favicon) ? favicon : null
  }
}

/**
 * Reads bookmarks.json as parsed JSON. Anything unexpected is dropped rather than trusted:
 * a file that isn't ours gives no bookmarks, and a bad entry (or a repeated id) is skipped.
 */
export function parseBookmarkFile(raw: unknown): Bookmark[] {
  if (typeof raw !== 'object' || raw === null) return []
  const { version, bookmarks } = raw as Record<string, unknown>
  if (version !== FILE_VERSION || !Array.isArray(bookmarks)) return []

  const seen = new Set<number>()
  const result: Bookmark[] = []
  for (const entry of bookmarks) {
    const bookmark = parseBookmark(entry)
    if (!bookmark || seen.has(bookmark.id)) continue
    seen.add(bookmark.id)
    result.push(bookmark)
    if (result.length === MAX_BOOKMARKS) break
  }
  return result
}

export function toBookmarkFile(bookmarks: readonly Bookmark[]): BookmarkFile {
  return { version: FILE_VERSION, bookmarks: [...bookmarks] }
}

export function findBookmark(bookmarks: readonly Bookmark[], url: string): Bookmark | undefined {
  return bookmarks.find((bookmark) => bookmark.url === url)
}

/**
 * Adds a bookmark at the end of the bar. Returns the same list when the page can't be
 * bookmarked, is already bookmarked, or the list is full.
 */
export function addBookmark(
  bookmarks: readonly Bookmark[],
  page: NewBookmark
): readonly Bookmark[] {
  if (!isBookmarkableUrl(page.url) || findBookmark(bookmarks, page.url)) return bookmarks
  if (bookmarks.length >= MAX_BOOKMARKS) return bookmarks
  const id = bookmarks.reduce((max, bookmark) => Math.max(max, bookmark.id), 0) + 1
  return [
    ...bookmarks,
    {
      id,
      url: page.url,
      title: cleanTitle(page.title, page.url),
      favicon: isFaviconDataUrl(page.favicon) ? page.favicon : null
    }
  ]
}

export function removeBookmark(bookmarks: readonly Bookmark[], id: number): readonly Bookmark[] {
  const result = bookmarks.filter((bookmark) => bookmark.id !== id)
  return result.length === bookmarks.length ? bookmarks : result
}

/** Removes every bookmark of `url` (a hand-edited file can hold the same URL twice). */
export function removeBookmarksOf(
  bookmarks: readonly Bookmark[],
  url: string
): readonly Bookmark[] {
  const result = bookmarks.filter((bookmark) => bookmark.url !== url)
  return result.length === bookmarks.length ? bookmarks : result
}

/** Gives the bookmarks of `url` a new icon. Returns the same list when nothing changes. */
export function setFavicon(
  bookmarks: readonly Bookmark[],
  url: string,
  favicon: string
): readonly Bookmark[] {
  if (!isFaviconDataUrl(favicon)) return bookmarks
  if (!bookmarks.some((bookmark) => bookmark.url === url && bookmark.favicon !== favicon)) {
    return bookmarks
  }
  return bookmarks.map((bookmark) => (bookmark.url === url ? { ...bookmark, favicon } : bookmark))
}
