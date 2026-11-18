import { describe, expect, test } from 'bun:test'
import {
  appFrame,
  formatComponentSource,
  parseComponentSource,
  parseReviewLoc
} from './component-source'

describe('parseComponentSource', () => {
  test('React up to 18: _debugSource', () => {
    expect(
      parseComponentSource({
        framework: 'react',
        component: 'Cart',
        file: 'C:/shop/src/Cart.tsx',
        line: 42,
        column: 9,
        stack: null
      })
    ).toEqual({
      framework: 'react',
      component: 'Cart',
      file: 'C:/shop/src/Cart.tsx',
      line: 42,
      column: 9,
      stack: null
    })
  })

  test('Svelte 4 counts from 0, Svelte 5 lines from 1', () => {
    const svelte4 = { framework: 'svelte', file: 'src/A.svelte', line: 4, column: 2 }
    expect(parseComponentSource({ ...svelte4, zeroBasedLine: true })).toMatchObject({
      line: 5,
      column: 3
    })
    expect(parseComponentSource({ ...svelte4, zeroBasedLine: false })).toMatchObject({
      line: 4,
      column: 3
    })
  })

  test('Vue: the file only', () => {
    expect(
      parseComponentSource({
        framework: 'vue',
        component: 'CartItem',
        file: '/app/src/CartItem.vue'
      })
    ).toMatchObject({ component: 'CartItem', file: '/app/src/CartItem.vue', line: null })
  })

  test('drops what a page made up', () => {
    expect(parseComponentSource(null)).toBeNull()
    expect(parseComponentSource('react')).toBeNull()
    expect(parseComponentSource({ framework: 'angular', file: 'x.ts' })).toBeNull()
    expect(parseComponentSource({ framework: 'react' })).toBeNull()
    expect(
      parseComponentSource({
        framework: 'react',
        component: { toString: () => 'x' },
        file: 42,
        line: -1,
        column: 1.5,
        stack: 'Error\n    at x'
      })
    ).toEqual({
      framework: 'react',
      component: null,
      file: null,
      line: null,
      column: null,
      stack: 'Error\n    at x'
    })
    // A line without a file says nothing.
    expect(parseComponentSource({ framework: 'react', component: 'A', line: 3 })).toMatchObject({
      line: null
    })
  })
})

describe('appFrame', () => {
  test('React 19: the first frame outside React itself', () => {
    const stack = [
      'Error: react-stack-top-frame',
      '    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:33)',
      '    at Cart (http://localhost:5173/src/Cart.tsx?t=2:31:7)',
      '    at App (http://localhost:5173/src/App.tsx:12:5)'
    ].join('\n')
    expect(appFrame(stack)).toEqual({
      url: 'http://localhost:5173/src/Cart.tsx?t=2',
      line: 31,
      column: 7
    })
  })

  test('null when every frame is the framework’s', () => {
    expect(appFrame('Error\n    at x (http://h/node_modules/react-dom/index.js:1:1)')).toBeNull()
  })
})

describe('formatComponentSource', () => {
  const base = {
    framework: 'react' as const,
    component: 'Cart',
    file: null,
    line: null,
    column: null,
    stack: null
  }

  test('a file and line from the dev build', () => {
    expect(
      formatComponentSource({ ...base, file: 'C:\\shop\\src\\Cart.tsx', line: 42, column: 9 })
    ).toBe('C:/shop/src/Cart.tsx:42:9 (React, in <Cart>)')
    expect(
      formatComponentSource({ ...base, framework: 'vue', component: null, file: 'src/A.vue' })
    ).toBe('src/A.vue (Vue)')
  })

  test('a place from the stack, resolved or not', () => {
    const frame = { url: 'http://localhost:5173/assets/x.js', line: 1, column: 900 }
    expect(
      formatComponentSource(
        base,
        { source: 'src/Cart.tsx', line: 31, column: 7, name: null },
        frame
      )
    ).toBe('src/Cart.tsx:31:7 (React, in <Cart>)')
    expect(formatComponentSource(base, null, frame)).toBe(
      'http://localhost:5173/assets/x.js:1:900 (React, in <Cart>) (no source map)'
    )
    expect(formatComponentSource(base)).toContain('unknown file (React, in <Cart>)')
  })
})

describe('data-review-loc', () => {
  test('reads file:line and file:line:column, Windows drives included', () => {
    expect(parseReviewLoc('src/App.tsx:12')).toEqual({
      file: 'src/App.tsx',
      line: 12,
      column: null
    })
    expect(parseReviewLoc('C:/app/src/App.tsx:12:5')).toEqual({
      file: 'C:/app/src/App.tsx',
      line: 12,
      column: 5
    })
    expect(parseReviewLoc('src/App.tsx')).toBeNull()
    expect(parseReviewLoc('src/App.tsx:0')).toBeNull()
    expect(parseReviewLoc(':12')).toBeNull()
  })

  test('is a source of its own, shown as data-review-loc', () => {
    const source = parseComponentSource({ framework: 'markup', loc: 'src/Field.tsx:8:3' })
    expect(source).toEqual({
      framework: 'markup',
      component: null,
      file: 'src/Field.tsx',
      line: 8,
      column: 3,
      stack: null
    })
    expect(formatComponentSource(source!)).toBe('src/Field.tsx:8:3 (data-review-loc)')
    expect(parseComponentSource({ framework: 'markup', loc: 'nowhere' })).toBeNull()
  })
})
