import { describe, expect, test } from 'bun:test'
import {
  FILTER_LISTS,
  RETRY_INTERVAL_MS,
  UPDATE_INTERVAL_MS,
  emptySeenTokens,
  isSite,
  isUpdateDue,
  parseDomTokens,
  shieldStatus,
  siteOf,
  takeUnseen,
  togglePausedSite
} from './adblock-policy'

describe('FILTER_LISTS', () => {
  test('are distinct https URLs', () => {
    for (const url of FILTER_LISTS) expect(new URL(url).protocol).toBe('https:')
    expect(new Set(FILTER_LISTS).size).toBe(FILTER_LISTS.length)
  })
})

describe('siteOf', () => {
  test('is the hostname without www.', () => {
    expect(siteOf('https://www.example.com/a?b#c')).toBe('example.com')
    expect(siteOf('http://news.example.co.uk:8080/')).toBe('news.example.co.uk')
    expect(siteOf('https://WWW.Example.COM/')).toBe('example.com')
    expect(siteOf('http://localhost:3000/')).toBe('localhost')
    expect(siteOf('http://[::1]/')).toBe('[::1]')
  })

  test('is null for pages that are not on the web', () => {
    expect(siteOf('browminal://home/')).toBeNull()
    expect(siteOf('file:///C:/x.html')).toBeNull()
    expect(siteOf('about:blank')).toBeNull()
    expect(siteOf('')).toBeNull()
  })
})

describe('isSite', () => {
  test('accepts what siteOf returns', () => {
    expect(isSite('example.com')).toBe(true)
    expect(isSite('localhost')).toBe(true)
  })

  test('rejects anything else', () => {
    for (const value of ['www.example.com', 'Example.com', 'a/b', 'x.com:80', '', ' ', 1, null]) {
      expect(isSite(value)).toBe(false)
    }
    expect(isSite(`${'a'.repeat(250)}.com`)).toBe(false)
  })
})

describe('togglePausedSite', () => {
  test('adds and removes a site without changing the input', () => {
    const sites = ['a.com']
    expect(togglePausedSite(sites, 'b.com')).toEqual(['a.com', 'b.com'])
    expect(togglePausedSite(sites, 'a.com')).toEqual([])
    expect(sites).toEqual(['a.com'])
  })
})

describe('shieldStatus', () => {
  test('off everywhere wins, then paused on the site', () => {
    expect(shieldStatus({ enabled: false, paused: true, engine: 'ready' })).toBe('off')
    expect(shieldStatus({ enabled: true, paused: true, engine: 'failed' })).toBe('paused')
  })

  test('otherwise follows the engine', () => {
    expect(shieldStatus({ enabled: true, paused: false, engine: 'ready' })).toBe('on')
    expect(shieldStatus({ enabled: true, paused: false, engine: 'loading' })).toBe('loading')
    expect(shieldStatus({ enabled: true, paused: false, engine: 'failed' })).toBe('unavailable')
  })
})

describe('isUpdateDue', () => {
  const now = 1_800_000_000_000

  test('is due with no lists yet, or lists a day old', () => {
    expect(isUpdateDue({ lastUpdated: null, lastAttempt: null, now })).toBe(true)
    expect(isUpdateDue({ lastUpdated: now - UPDATE_INTERVAL_MS, lastAttempt: null, now })).toBe(
      true
    )
    expect(isUpdateDue({ lastUpdated: now - 1000, lastAttempt: null, now })).toBe(false)
  })

  test('waits after a try', () => {
    const lastAttempt = now - RETRY_INTERVAL_MS + 1
    expect(isUpdateDue({ lastUpdated: null, lastAttempt, now })).toBe(false)
    expect(isUpdateDue({ lastUpdated: null, lastAttempt: now - RETRY_INTERVAL_MS, now })).toBe(true)
  })

  test('is due when the clock went back', () => {
    expect(isUpdateDue({ lastUpdated: now + 60_000, lastAttempt: null, now })).toBe(true)
    expect(isUpdateDue({ lastUpdated: null, lastAttempt: now + 60_000, now })).toBe(true)
  })
})

describe('parseDomTokens', () => {
  test('keeps lists of non-empty strings', () => {
    expect(parseDomTokens({ classes: ['ad', '', 3, null], ids: 'top' })).toEqual({
      classes: ['ad'],
      ids: []
    })
  })

  test('gives empty lists for anything else', () => {
    const empty = { classes: [], ids: [] }
    expect(parseDomTokens(null)).toEqual(empty)
    expect(parseDomTokens('classes')).toEqual(empty)
    expect(parseDomTokens(undefined)).toEqual(empty)
  })

  test('caps the count and length', () => {
    const many = Array.from({ length: 6000 }, (_, i) => `c${i}`)
    const { classes, ids } = parseDomTokens({ classes: many, ids: ['x'.repeat(3000), 'y'] })
    expect(classes).toHaveLength(5000)
    expect(ids).toEqual(['y'])
  })
})

describe('takeUnseen', () => {
  test('returns only new tokens, and remembers them', () => {
    const seen = emptySeenTokens()
    expect(takeUnseen(seen, { classes: ['a', 'b'], ids: [] })).toEqual({
      classes: ['a', 'b'],
      ids: []
    })
    expect(takeUnseen(seen, { classes: ['b', 'c'], ids: ['x'] })).toEqual({
      classes: ['c'],
      ids: ['x']
    })
    expect(takeUnseen(seen, { classes: ['a'], ids: ['x'] })).toBeNull()
  })
})
