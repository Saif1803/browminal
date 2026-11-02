import { describe, expect, test } from 'bun:test'
import {
  decodeDataUrl,
  displaySource,
  locationsIn,
  mapRefFor,
  replaceLocations,
  SourceMaps
} from './source-maps'

const SCRIPT = 'http://localhost:3000/assets/index-a1b2.js'
const MAP_URL = `${SCRIPT}.map`

// Generated line 1, column 0 → Cart.tsx line 10 column 3; column 10 → line 20 column 5 (named
// handleClick); line 3, column 4 → util.ts line 3 column 1. Line 2 maps nothing.
const MAP = {
  version: 3,
  sources: ['webpack://shop/./src/components/Cart.tsx', '../../src/util.ts'],
  names: ['handleClick'],
  mappings: 'AASE,UAUEA;;ICjBJ'
}

const base64 = (text: string): string => Buffer.from(text).toString('base64')

function loader(files: Record<string, string>): {
  load: (url: string) => Promise<string>
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    load: async (url) => {
      calls.push(url)
      if (!(url in files)) throw new Error('404')
      return files[url]
    }
  }
}

describe('mapRefFor', () => {
  test('resolves a relative map URL against the script', () => {
    expect(mapRefFor(SCRIPT, 'index-a1b2.js.map')).toEqual({ url: MAP_URL, base: MAP_URL })
  })

  test('inline maps resolve their sources against the script', () => {
    const url = `data:application/json;base64,${base64('{}')}`
    expect(mapRefFor(SCRIPT, url)).toEqual({ url, base: SCRIPT })
  })

  test('refuses maps on another origin or scheme, and no map at all', () => {
    expect(mapRefFor(SCRIPT, 'https://evil.example/x.map')).toBeNull()
    expect(mapRefFor(SCRIPT, 'file:///C:/secret.map')).toBeNull()
    expect(mapRefFor(SCRIPT, '')).toBeNull()
    expect(mapRefFor('not a url', 'x.map')).toBeNull()
  })
})

describe('decodeDataUrl', () => {
  test('base64 and percent-encoded', () => {
    expect(decodeDataUrl(`data:application/json;charset=utf-8;base64,${base64('{"a":1}')}`)).toBe(
      '{"a":1}'
    )
    expect(decodeDataUrl('data:application/json,%7B%22a%22%3A1%7D')).toBe('{"a":1}')
    expect(decodeDataUrl('https://x/y.map')).toBeNull()
  })
})

describe('displaySource', () => {
  const page = 'http://localhost:5173/src/App.tsx'
  test.each([
    [
      'webpack://shop/./src/components/Cart.tsx',
      'webpack://shop/src/components/Cart.tsx',
      'src/components/Cart.tsx'
    ],
    ['webpack-internal:///./src/a.ts', 'webpack-internal:///src/a.ts', 'src/a.ts'],
    ['webpack://_N_E/(app-pages-browser)/./src/app/page.tsx', 'x', 'src/app/page.tsx'],
    ['turbopack:///[project]/src/app/page.tsx', 'x', 'src/app/page.tsx'],
    ['C:\\Users\\me\\shop\\src\\App.tsx', 'x', 'C:/Users/me/shop/src/App.tsx'],
    ['file:///C:/Users/me/shop/src/App%20Two.tsx', 'x', 'C:/Users/me/shop/src/App Two.tsx'],
    ['file:///home/me/shop/src/App.tsx', 'x', '/home/me/shop/src/App.tsx'],
    [
      '/Users/me/shop/src/App.tsx',
      'http://localhost:5173/Users/me/shop/src/App.tsx',
      '/Users/me/shop/src/App.tsx'
    ],
    ['App.tsx', page, 'src/App.tsx'],
    ['/src/App.tsx?t=1712', 'http://localhost:5173/src/App.tsx?t=1712', 'src/App.tsx'],
    [
      '/@fs/C:/libs/ui/Button.tsx',
      'http://localhost:5173/@fs/C:/libs/ui/Button.tsx',
      'C:/libs/ui/Button.tsx'
    ]
  ])('%s', (raw, resolved, shown) => {
    expect(displaySource(raw, resolved)).toBe(shown)
  })
})

describe('SourceMaps', () => {
  test('resolves places in a registered script, loading its map once', async () => {
    const { load, calls } = loader({ [MAP_URL]: JSON.stringify(MAP) })
    const maps = new SourceMaps(load)
    maps.register(SCRIPT, 'index-a1b2.js.map')
    expect(maps.has(SCRIPT)).toBe(true)

    expect(await maps.resolve({ url: SCRIPT, line: 1, column: 1 })).toEqual({
      source: 'src/components/Cart.tsx',
      line: 10,
      column: 3,
      name: null
    })
    expect(await maps.resolve({ url: SCRIPT, line: 1, column: 15 })).toEqual({
      source: 'src/components/Cart.tsx',
      line: 20,
      column: 5,
      name: 'handleClick'
    })
    expect(await maps.resolve({ url: SCRIPT, line: 3, column: 5 })).toEqual({
      source: 'src/util.ts',
      line: 3,
      column: 1,
      name: null
    })
    expect(await maps.resolve({ url: SCRIPT, line: 2, column: 1 })).toBeNull()
    expect(calls).toEqual([MAP_URL])
  })

  test('inline maps need no loading', async () => {
    const { load, calls } = loader({})
    const maps = new SourceMaps(load)
    maps.register(SCRIPT, `data:application/json;base64,${base64(JSON.stringify(MAP))}`)
    expect((await maps.resolve({ url: SCRIPT, line: 1, column: 1 }))?.source).toBe(
      'src/components/Cart.tsx'
    )
    expect(calls).toEqual([])
  })

  test('unknown scripts, missing maps, broken maps and too-big maps resolve to null', async () => {
    const { load } = loader({ 'http://localhost:3000/broken.js.map': '{not json' })
    const maps = new SourceMaps(load, 10)
    expect(await maps.resolve({ url: SCRIPT, line: 1, column: 1 })).toBeNull()
    maps.register('http://localhost:3000/missing.js', 'missing.js.map')
    maps.register('http://localhost:3000/broken.js', 'broken.js.map')
    maps.register(SCRIPT, `data:application/json,${encodeURIComponent(JSON.stringify(MAP))}`)
    for (const url of [
      'http://localhost:3000/missing.js',
      'http://localhost:3000/broken.js',
      SCRIPT
    ])
      expect(await maps.resolve({ url, line: 1, column: 1 })).toBeNull()
  })

  test('a script parsed again without a map forgets the old one', async () => {
    const { load } = loader({ [MAP_URL]: JSON.stringify(MAP) })
    const maps = new SourceMaps(load)
    maps.register(SCRIPT, 'index-a1b2.js.map')
    maps.register(SCRIPT, '')
    expect(maps.has(SCRIPT)).toBe(false)
  })

  test('resolveAll looks up many places at once', async () => {
    const { load } = loader({ [MAP_URL]: JSON.stringify(MAP) })
    const maps = new SourceMaps(load)
    maps.register(SCRIPT, 'index-a1b2.js.map')
    const lookup = await maps.resolveAll([
      { url: SCRIPT, line: 1, column: 1 },
      { url: 'http://other/x.js', line: 1, column: 1 }
    ])
    expect(lookup(SCRIPT, 1, 1)?.line).toBe(10)
    expect(lookup('http://other/x.js', 1, 1)).toBeNull()
    expect(lookup(SCRIPT, 3, 5)).toBeNull() // not asked for
  })
})

describe('locations in text', () => {
  const stack = [
    'TypeError: x is undefined',
    `    at handleClick (${SCRIPT}:1:15)`,
    `    at ${SCRIPT}:3:5`,
    '    at http://localhost:5173/src/App.tsx?t=1712:12:5'
  ].join('\n')

  test('locationsIn finds each url:line:column, ports and queries included', () => {
    expect(locationsIn(stack)).toEqual([
      { url: SCRIPT, line: 1, column: 15 },
      { url: SCRIPT, line: 3, column: 5 },
      { url: 'http://localhost:5173/src/App.tsx?t=1712', line: 12, column: 5 }
    ])
  })

  test('replaceLocations swaps the ones that resolve', () => {
    const replaced = replaceLocations(stack, (url, line) =>
      url === SCRIPT ? { source: 'src/Cart.tsx', line: line * 10, column: 2, name: null } : null
    )
    expect(replaced).toBe(
      [
        'TypeError: x is undefined',
        '    at handleClick (src/Cart.tsx:10:2)',
        '    at src/Cart.tsx:30:2',
        '    at http://localhost:5173/src/App.tsx?t=1712:12:5'
      ].join('\n')
    )
  })
})
