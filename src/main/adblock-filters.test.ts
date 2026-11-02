import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cosmeticStyles, loadEngine, shouldBlock } from './adblock-filters'
import native from './native'

const folder = mkdtempSync(join(tmpdir(), 'nebula-adblock-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

const LISTS = [
  '||ads.example^',
  '@@||ads.example/allowed^',
  '||tracker.example^$third-party',
  '||cdn.example/ad.js$script,redirect=noop.js',
  '||api.example/collect$method=post',
  '||socket.example^$websocket',
  '##.adbox',
  '###banner',
  'news.example##.sponsored',
  'news.example#@#.adbox',
  '@@||plain.example^$generichide',
  '##+js(set-constant, adsEnabled, false)'
].join('\n')

// What the worker does (adblock-worker.ts).
const saved = join(folder, 'engine.bin')
native.buildAdblockEngine(LISTS, saved)
const engine = (await loadEngine(saved))!

const request = (url: string, type = 'image', sourceUrl = 'https://site.example/'): boolean =>
  shouldBlock(engine, { url, type, sourceUrl })

describe('buildAdblockEngine / loadEngine', () => {
  test('round-trips through a file', () => {
    expect(engine).not.toBeNull()
    expect(request('https://ads.example/banner.png')).toBe(true)
  })

  test('rejects files that are not an engine, or not there', async () => {
    const file = join(folder, 'other.bin')
    writeFileSync(file, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(await loadEngine(file)).toBeNull()
    writeFileSync(file, '')
    expect(await loadEngine(file)).toBeNull()
    const damaged = readFileSync(saved)
    damaged[damaged.length - 10] ^= 0xff
    writeFileSync(file, damaged)
    expect(await loadEngine(file)).toBeNull()
    expect(await loadEngine(join(folder, 'missing.bin'))).toBeNull()
  })

  test('throws when it cannot save', () => {
    expect(() => native.buildAdblockEngine('', join(folder, 'no', 'such', 'folder.bin'))).toThrow()
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

  test("maps Electron's request types", () => {
    expect(request('wss://socket.example/live', 'webSocket')).toBe(true)
    expect(request('https://socket.example/live', 'xhr')).toBe(false)
  })

  test('treats unknown request types as "other"', () => {
    expect(request('https://ads.example/x', 'somethingNew')).toBe(true)
  })

  test('matches $method rules by the request method', () => {
    const collect = { url: 'https://api.example/collect', type: 'xhr', sourceUrl: 'https://a.b/' }
    expect(shouldBlock(engine, { ...collect, method: 'POST' })).toBe(true)
    expect(shouldBlock(engine, { ...collect, method: 'GET' })).toBe(false)
  })

  test('lets through what it cannot match', () => {
    expect(request('data:image/png;base64,AAAA')).toBe(false)
    expect(request('not a url')).toBe(false)
  })
})

describe('cosmeticStyles', () => {
  test("gives the site's rules and the generic ones", () => {
    const css = cosmeticStyles(engine, 'https://www.news.example/story', null)
    expect(css).toContain('.sponsored')
    expect(css).toContain('display: none !important')
    expect(cosmeticStyles(engine, 'https://other.example/', null)).not.toContain('.sponsored')
  })

  test('gives generic rules for what is on the page, minus the site exceptions', () => {
    const dom = { classes: ['adbox', 'content'], ids: ['banner'] }
    const css = cosmeticStyles(engine, 'https://other.example/', dom)
    expect(css).toContain('.adbox')
    expect(css).toContain('#banner')
    expect(css).not.toContain('.content')
    expect(cosmeticStyles(engine, 'https://news.example/', dom)).not.toContain('.adbox')
  })

  test('gives no generic rules where the site turns them off', () => {
    const dom = { classes: ['adbox'], ids: ['banner'] }
    expect(cosmeticStyles(engine, 'https://plain.example/', dom)).toBe('')
  })

  test('never includes scriptlets', () => {
    const css = cosmeticStyles(engine, 'https://other.example/', null)
    expect(css).not.toContain('set-constant')
    expect(css).not.toContain('adsEnabled')
  })

  test('gives nothing for a page it cannot read', () => {
    expect(cosmeticStyles(engine, 'not a url', null)).toBe('')
  })
})
