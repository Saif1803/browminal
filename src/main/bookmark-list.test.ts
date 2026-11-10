import { describe, expect, test } from 'bun:test'
import type { Bookmark } from '../shared/types'
import {
  MAX_BOOKMARKS,
  MAX_FAVICON_LENGTH,
  MAX_TITLE_LENGTH,
  addBookmark,
  cleanTitle,
  findBookmark,
  isBookmarkableUrl,
  isFaviconDataUrl,
  parseBookmarkFile,
  removeBookmark,
  removeBookmarksOf,
  setFavicon,
  toBookmarkFile
} from './bookmark-list'

const ICON = 'data:image/png;base64,iVBORw0KGgo='
const OTHER_ICON = 'data:image/x-icon;base64,AAABAA=='

const bookmark = (id: number, url = `https://example.com/${id}`): Bookmark => ({
  id,
  url,
  title: `Page ${id}`,
  favicon: null
})

describe('isBookmarkableUrl', () => {
  test('accepts http(s) URLs', () => {
    expect(isBookmarkableUrl('https://example.com/')).toBe(true)
    expect(isBookmarkableUrl('http://localhost:3000/a?b#c')).toBe(true)
  })

  test('rejects other schemes and broken URLs', () => {
    expect(isBookmarkableUrl('browminal://home/')).toBe(false)
    expect(isBookmarkableUrl('javascript:alert(1)')).toBe(false)
    expect(isBookmarkableUrl('file:///C:/Windows/')).toBe(false)
    expect(isBookmarkableUrl('https://')).toBe(false)
    expect(isBookmarkableUrl('')).toBe(false)
  })

  test('rejects very long URLs', () => {
    expect(isBookmarkableUrl(`https://example.com/${'a'.repeat(9000)}`)).toBe(false)
  })
})

describe('isFaviconDataUrl', () => {
  test('accepts base64 images in the formats favicons.ts makes', () => {
    expect(isFaviconDataUrl(ICON)).toBe(true)
    expect(isFaviconDataUrl(OTHER_ICON)).toBe(true)
    expect(isFaviconDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(true)
  })

  test('rejects anything else', () => {
    expect(isFaviconDataUrl('https://example.com/favicon.ico')).toBe(false)
    expect(isFaviconDataUrl('data:text/html;base64,PGI+')).toBe(false)
    expect(isFaviconDataUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false)
    expect(isFaviconDataUrl('data:image/png;base64,abc"onerror=x')).toBe(false)
    expect(isFaviconDataUrl(null)).toBe(false)
    expect(isFaviconDataUrl(42)).toBe(false)
  })

  test('rejects big icons', () => {
    expect(isFaviconDataUrl(`data:image/png;base64,${'A'.repeat(MAX_FAVICON_LENGTH)}`)).toBe(false)
  })
})

describe('cleanTitle', () => {
  test('keeps one trimmed line', () => {
    expect(cleanTitle('  Hello\n\tworld  ', 'https://a.com/')).toBe('Hello world')
  })

  test('falls back to the URL', () => {
    expect(cleanTitle('   ', 'https://a.com/')).toBe('https://a.com/')
  })

  test('shortens long titles', () => {
    const title = cleanTitle('x'.repeat(1000), 'https://a.com/')
    expect(title.length).toBe(MAX_TITLE_LENGTH)
    expect(title.endsWith('…')).toBe(true)
  })
})

describe('parseBookmarkFile', () => {
  test('reads what toBookmarkFile writes', () => {
    const list = [bookmark(1), { ...bookmark(2), favicon: ICON }]
    expect(parseBookmarkFile(JSON.parse(JSON.stringify(toBookmarkFile(list))))).toEqual(list)
  })

  test('gives no bookmarks for files that are not ours', () => {
    expect(parseBookmarkFile(undefined)).toEqual([])
    expect(parseBookmarkFile(null)).toEqual([])
    expect(parseBookmarkFile([bookmark(1)])).toEqual([])
    expect(parseBookmarkFile({ version: 2, bookmarks: [bookmark(1)] })).toEqual([])
    expect(parseBookmarkFile({ version: 1, bookmarks: 'nope' })).toEqual([])
  })

  test('skips bad entries and keeps the rest', () => {
    const file = {
      version: 1,
      bookmarks: [
        bookmark(1),
        null,
        { id: 'two', url: 'https://a.com/', title: 'A' },
        { id: 3, url: 'javascript:alert(1)', title: 'Evil' },
        { id: 0, url: 'https://a.com/', title: 'Zero' },
        { id: 1.5, url: 'https://a.com/', title: 'Fraction' },
        bookmark(4)
      ]
    }
    expect(parseBookmarkFile(file).map((entry) => entry.id)).toEqual([1, 4])
  })

  test('keeps the first of repeated ids', () => {
    const file = { version: 1, bookmarks: [bookmark(1, 'https://a.com/'), bookmark(1)] }
    expect(parseBookmarkFile(file)).toEqual([bookmark(1, 'https://a.com/')])
  })

  test('cleans titles and drops unusable icons', () => {
    const file = {
      version: 1,
      bookmarks: [
        { id: 1, url: 'https://a.com/', title: 42, favicon: 'https://a.com/favicon.ico' },
        { id: 2, url: 'https://b.com/', title: ' B\n', favicon: ICON, extra: true }
      ]
    }
    expect(parseBookmarkFile(file)).toEqual([
      { id: 1, url: 'https://a.com/', title: 'https://a.com/', favicon: null },
      { id: 2, url: 'https://b.com/', title: 'B', favicon: ICON }
    ])
  })

  test('stops at MAX_BOOKMARKS', () => {
    const bookmarks = Array.from({ length: MAX_BOOKMARKS + 5 }, (_, i) => bookmark(i + 1))
    expect(parseBookmarkFile({ version: 1, bookmarks }).length).toBe(MAX_BOOKMARKS)
  })
})

describe('addBookmark', () => {
  const page = { url: 'https://new.com/', title: 'New', favicon: ICON }

  test('adds at the end with the next id', () => {
    const list = addBookmark([bookmark(3), bookmark(1)], page)
    expect(list.at(-1)).toEqual({ id: 4, ...page })
    expect(addBookmark([], page)[0].id).toBe(1)
  })

  test('cleans the title and drops an unusable icon', () => {
    const [added] = addBookmark([], { url: page.url, title: '', favicon: 'data:text/html,x' })
    expect(added).toEqual({ id: 1, url: page.url, title: page.url, favicon: null })
  })

  test('does nothing for pages that are bookmarked or can not be', () => {
    const list = [bookmark(1, page.url)]
    expect(addBookmark(list, page)).toBe(list)
    const empty: Bookmark[] = []
    expect(addBookmark(empty, { ...page, url: 'browminal://home/' })).toBe(empty)
  })

  test('does nothing when the list is full', () => {
    const full = Array.from({ length: MAX_BOOKMARKS }, (_, i) => bookmark(i + 1))
    expect(addBookmark(full, page)).toBe(full)
  })
})

describe('removing', () => {
  const list = [bookmark(1), bookmark(2, 'https://a.com/'), bookmark(3, 'https://a.com/')]

  test('removeBookmark removes one id', () => {
    expect(removeBookmark(list, 2).map((entry) => entry.id)).toEqual([1, 3])
    expect(removeBookmark(list, 9)).toBe(list)
  })

  test('removeBookmarksOf removes every bookmark of a URL', () => {
    expect(removeBookmarksOf(list, 'https://a.com/').map((entry) => entry.id)).toEqual([1])
    expect(removeBookmarksOf(list, 'https://b.com/')).toBe(list)
  })

  test('findBookmark finds by exact URL', () => {
    expect(findBookmark(list, 'https://a.com/')?.id).toBe(2)
    expect(findBookmark(list, 'https://a.com')).toBeUndefined()
  })
})

describe('setFavicon', () => {
  test('updates the icon of bookmarks with that URL', () => {
    const list = [bookmark(1), bookmark(2, 'https://a.com/')]
    const next = setFavicon(list, 'https://a.com/', ICON)
    expect(next[0]).toBe(list[0])
    expect(next[1].favicon).toBe(ICON)
  })

  test('returns the same list when nothing changes', () => {
    const list = [{ ...bookmark(1), favicon: ICON }]
    expect(setFavicon(list, list[0].url, ICON)).toBe(list)
    expect(setFavicon(list, 'https://other.com/', OTHER_ICON)).toBe(list)
    expect(setFavicon(list, list[0].url, 'data:text/html,x')).toBe(list)
  })
})
