import { describe, expect, test } from 'bun:test'
import { HOME_URL } from '../shared/url'
import {
  EMPTY_SESSION,
  MAX_SESSION_TABS,
  isWorthRestoring,
  parseSessionFile,
  sessionOf,
  toSessionFile
} from './session-file'

const tab = (url: string, title = 'A page'): { url: string; title: string } => ({ url, title })

describe('parseSessionFile', () => {
  test('a missing or foreign file is an empty session', () => {
    for (const raw of [undefined, null, 'tabs', [], {}, { version: 2, tabs: [] }, { version: 1 }]) {
      expect(parseSessionFile(raw)).toEqual(EMPTY_SESSION)
    }
  })

  test('reads back what was written', () => {
    const session = {
      tabs: [tab('https://a.example/'), tab(HOME_URL, 'Start'), tab('http://localhost:5173/x')],
      active: 2
    }
    expect(parseSessionFile(toSessionFile(session))).toEqual(session)
  })

  test('drops tabs main would not load, and the tab in front moves with the rest', () => {
    const session = parseSessionFile({
      version: 1,
      tabs: [
        tab('file:///etc/passwd'),
        tab('https://a.example/'),
        tab('browminal://error/?code=X&url=https%3A%2F%2Fb.example'),
        tab('javascript:alert(1)'),
        { url: 42 },
        'https://c.example/',
        tab('https://d.example/')
      ],
      active: 6
    })
    expect(session.tabs.map((saved) => saved.url)).toEqual([
      'https://a.example/',
      'https://d.example/'
    ])
    expect(session.active).toBe(1)
  })

  test('a tab in front that was dropped, or a wrong index, gives the first tab', () => {
    const tabs = [tab('file:///x'), tab('https://a.example/'), tab('https://b.example/')]
    expect(parseSessionFile({ version: 1, tabs, active: 0 }).active).toBe(0)
    expect(parseSessionFile({ version: 1, tabs, active: 99 }).active).toBe(0)
    expect(parseSessionFile({ version: 1, tabs, active: 'last' }).active).toBe(0)
  })

  test('titles are cleaned, and a missing one is the URL', () => {
    const { tabs } = parseSessionFile({
      version: 1,
      tabs: [{ url: 'https://a.example/', title: '  Two\n lines ' }, { url: 'https://b.example/' }],
      active: 0
    })
    expect(tabs.map((saved) => saved.title)).toEqual(['Two lines', 'https://b.example/'])
  })

  test('keeps at most MAX_SESSION_TABS tabs', () => {
    const tabs = Array.from({ length: MAX_SESSION_TABS + 20 }, (_, i) =>
      tab(`https://a.example/${i}`)
    )
    expect(parseSessionFile({ version: 1, tabs, active: 0 }).tabs).toHaveLength(MAX_SESSION_TABS)
  })
})

describe('sessionOf', () => {
  test('saves only tabs that can come back', () => {
    const session = sessionOf([tab('about:blank'), tab('https://a.example/')], 1)
    expect(session).toEqual({ tabs: [tab('https://a.example/')], active: 0 })
  })
})

describe('isWorthRestoring', () => {
  test('not for no tabs or a lone start page', () => {
    expect(isWorthRestoring(EMPTY_SESSION)).toBe(false)
    expect(isWorthRestoring({ tabs: [tab(HOME_URL)], active: 0 })).toBe(false)
  })

  test('for a web page, or several tabs', () => {
    expect(isWorthRestoring({ tabs: [tab('https://a.example/')], active: 0 })).toBe(true)
    expect(isWorthRestoring({ tabs: [tab(HOME_URL), tab(HOME_URL)], active: 0 })).toBe(true)
  })
})
