import { describe, expect, test } from 'bun:test'
import type { Bookmark } from '../shared/types'
import {
  MAX_HISTORY,
  MAX_HISTORY_URL,
  parseHistoryFile,
  recordVisit,
  retitle,
  suggest,
  toHistoryFile,
  type HistoryEntry
} from './history-list'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

const entry = (url: string, title = url, daysAgo = 0, visits = 1): HistoryEntry => ({
  url,
  title,
  lastVisit: NOW - daysAgo * DAY,
  visits
})

const bookmark = (id: number, url: string, title = url): Bookmark => ({
  id,
  url,
  title,
  favicon: null
})

describe('parseHistoryFile', () => {
  test('a missing or foreign file is an empty history', () => {
    for (const raw of [undefined, null, 'x', [], {}, { version: 9, entries: [] }]) {
      expect(parseHistoryFile(raw)).toEqual([])
    }
  })

  test('reads back what was written', () => {
    const entries = [entry('https://a.example/', 'A'), entry('http://localhost:3000/', 'Dev', 2, 7)]
    expect(parseHistoryFile(toHistoryFile(entries))).toEqual(entries)
  })

  test('drops entries that are not web pages, and repeats', () => {
    const entries = parseHistoryFile({
      version: 1,
      entries: [
        entry('https://a.example/'),
        entry('file:///etc/passwd'),
        entry('browminal://home/'),
        entry('https://a.example/', 'Again'),
        { url: 'https://b.example/', title: 'No time' },
        { url: 'https://c.example/', lastVisit: 5, visits: 'many' },
        entry(`https://long.example/${'x'.repeat(MAX_HISTORY_URL)}`)
      ]
    })
    expect(entries.map((kept) => kept.url)).toEqual(['https://a.example/', 'https://c.example/'])
    expect(entries[1].visits).toBe(1)
  })

  test('comes back newest first', () => {
    const entries = parseHistoryFile(
      toHistoryFile([entry('https://old.example/', 'Old', 9), entry('https://new.example/')])
    )
    expect(entries.map((kept) => kept.url)).toEqual([
      'https://new.example/',
      'https://old.example/'
    ])
  })
})

describe('recordVisit', () => {
  test('a new page goes to the front', () => {
    const entries = recordVisit([entry('https://a.example/')], 'https://b.example/', 'B', NOW)
    expect(entries).toEqual([entry('https://b.example/', 'B'), entry('https://a.example/')])
  })

  test('a page opened again moves to the front and counts once more', () => {
    const before = [entry('https://a.example/'), entry('https://b.example/', 'B', 3, 4)]
    const entries = recordVisit(before, 'https://b.example/', 'B now', NOW)
    expect(entries).toEqual([
      entry('https://b.example/', 'B now', 0, 5),
      entry('https://a.example/')
    ])
  })

  test('keeps the old title while the page has none yet', () => {
    const entries = recordVisit([entry('https://a.example/', 'A')], 'https://a.example/', '', NOW)
    expect(entries[0].title).toBe('A')
  })

  test('ignores pages that are not on the web', () => {
    const before = [entry('https://a.example/')]
    expect(recordVisit(before, 'browminal://home/', 'Home', NOW)).toBe(before)
    expect(recordVisit(before, 'about:blank', '', NOW)).toBe(before)
  })

  test('forgets the oldest pages beyond MAX_HISTORY', () => {
    let entries: readonly HistoryEntry[] = []
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      entries = recordVisit(entries, `https://a.example/${i}`, '', i)
    }
    expect(entries).toHaveLength(MAX_HISTORY)
    expect(entries[0].url).toBe(`https://a.example/${MAX_HISTORY + 4}`)
    expect(entries.at(-1)?.url).toBe('https://a.example/5')
  })
})

describe('retitle', () => {
  test('sets the title of a page in the history', () => {
    const entries = retitle([entry('https://a.example/', 'Loading…')], 'https://a.example/', 'A')
    expect(entries[0].title).toBe('A')
  })

  test('changes nothing for an unknown page, an empty title or the same title', () => {
    const before = [entry('https://a.example/', 'A')]
    expect(retitle(before, 'https://b.example/', 'B')).toBe(before)
    expect(retitle(before, 'https://a.example/', '  ')).toBe(before)
    expect(retitle(before, 'https://a.example/', 'A')).toBe(before)
  })
})

describe('suggest', () => {
  const history = [
    entry('https://github.com/pulls', 'Pull requests', 1, 12),
    entry('https://news.example/github-outage', 'GitHub was down', 0, 1),
    entry('http://localhost:5173/cart', 'Cart · Shop', 0, 40),
    entry('https://www.gitlab.com/', 'GitLab', 30, 2)
  ]

  test('nothing for an empty query or no match', () => {
    expect(suggest('', history, [], NOW)).toEqual([])
    expect(suggest('   ', history, [], NOW)).toEqual([])
    expect(suggest('zebra', history, [], NOW)).toEqual([])
  })

  test('an address that starts with what is typed comes first', () => {
    const urls = suggest('git', history, [], NOW).map((found) => found.url)
    expect(urls).toEqual([
      'https://github.com/pulls',
      'https://www.gitlab.com/',
      'https://news.example/github-outage'
    ])
  })

  test('matches the title too, and every word typed', () => {
    expect(suggest('cart', history, [], NOW)[0].url).toBe('http://localhost:5173/cart')
    expect(suggest('shop cart', history, [], NOW).map((found) => found.url)).toEqual([
      'http://localhost:5173/cart'
    ])
    expect(suggest('shop github', history, [], NOW)).toEqual([])
  })

  test('typing the scheme or www. still matches', () => {
    expect(suggest('https://github', history, [], NOW)[0].url).toBe('https://github.com/pulls')
    expect(suggest('www.gitlab', history, [], NOW)[0].url).toBe('https://www.gitlab.com/')
  })

  test('offers bookmarks, marked, once even when they were visited', () => {
    const bookmarks = [
      bookmark(1, 'https://github.com/pulls', 'My pulls'),
      bookmark(2, 'https://gitea.example/')
    ]
    const found = suggest('git', history, bookmarks, NOW)
    expect(found[0]).toEqual({ url: 'https://github.com/pulls', title: 'My pulls', bookmark: true })
    expect(found.filter((one) => one.url === 'https://github.com/pulls')).toHaveLength(1)
    expect(found.find((one) => one.url === 'https://gitea.example/')?.bookmark).toBe(true)
  })

  test('returns at most the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => entry(`https://a.example/${i}`))
    expect(suggest('a.example', many, [], NOW)).toHaveLength(6)
    expect(suggest('a.example', many, [], NOW, 3)).toHaveLength(3)
  })
})
