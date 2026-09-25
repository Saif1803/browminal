import { describe, expect, test } from 'bun:test'
import { buildEngine, cosmeticStyles, loadEngine, shouldBlock } from './adblock-filters'

const LISTS = [
  '||ads.example^',
  '@@||ads.example/allowed^',
  '||tracker.example^$third-party',
  '||cdn.example/ad.js$script,redirect=noop.js',
  '##.adbox',
  'news.example##.sponsored',
  'news.example#@#.adbox',
  '##+js(set-constant, adsEnabled, false)'
].join('\n')

const engine = loadEngine(buildEngine(LISTS))!

const request = (url: string, type = 'image', sourceUrl = 'https://site.example/'): boolean =>
  shouldBlock(engine, { url, type, sourceUrl })

describe('buildEngine / loadEngine', () => {
  test('round-trips through bytes', () => {
    expect(engine).not.toBeNull()
    expect(request('https://ads.example/banner.png')).toBe(true)
  })

  test('rejects bytes that are not an engine', () => {
    expect(loadEngine(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    const damaged = buildEngine(LISTS)
    damaged[damaged.length - 10] ^= 0xff
    expect(loadEngine(damaged)).toBeNull()
  })
})

describe('shouldBlock', () => {
  test('blocks matching requests and honours exceptions', () => {
    expect(request('https://ads.example/x.js', 'script')).toBe(true)
    expect(request('https://ads.example/allowed', 'script')).toBe(false)
    expect(request('https://site.example/app.js', 'script')).toBe(false)
  })

  test('knows first from third party by the page', () => {
    expect(request('https://tracker.example/t.gif')).toBe(true)
    expect(request('https://tracker.example/t.gif', 'image', 'https://www.tracker.example/')).toBe(
      false
    )
  })

  test('blocks redirect rules outright (no resources are loaded)', () => {
    expect(request('https://cdn.example/ad.js', 'script')).toBe(true)
  })

  test('never blocks a page itself', () => {
    expect(request('https://ads.example/', 'mainFrame')).toBe(false)
    expect(request('https://ads.example/', 'subFrame')).toBe(true)
  })

  test('treats unknown request types as "other"', () => {
    expect(request('https://ads.example/x', 'somethingNew')).toBe(true)
  })
})

describe('cosmeticStyles', () => {
  test("gives the site's rules and the generic ones", () => {
    const css = cosmeticStyles(engine, 'https://www.news.example/story', null)
    expect(css).toContain('.sponsored')
    expect(cosmeticStyles(engine, 'https://other.example/', null)).not.toContain('.sponsored')
  })

  test('gives generic rules for what is on the page, minus the site exceptions', () => {
    const dom = { classes: ['adbox', 'content'], ids: [], hrefs: [] }
    expect(cosmeticStyles(engine, 'https://other.example/', dom)).toContain('.adbox')
    expect(cosmeticStyles(engine, 'https://news.example/', dom)).not.toContain('.adbox')
  })

  test('never includes scriptlets', () => {
    const css = cosmeticStyles(engine, 'https://other.example/', null)
    expect(css).not.toContain('set-constant')
    expect(css).not.toContain('adsEnabled')
  })
})
