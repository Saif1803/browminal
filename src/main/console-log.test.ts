import { describe, expect, test } from 'bun:test'
import {
  ConsoleLog,
  formatConsoleArgs,
  formatConsoleEntry,
  formatRemoteObject,
  fromConsoleApiCalled,
  fromExceptionThrown,
  fromLogEntry,
  navigationEntry,
  positionsOf,
  type NewConsoleEntry
} from './console-log'
import type { PositionLookup } from './source-maps'

const str = (value: string): { type: string; value: string } => ({ type: 'string', value })
const num = (value: number): { type: string; value: number } => ({ type: 'number', value })
const at = new Date(2026, 10, 2, 14, 3, 7, 215).getTime()

describe('formatRemoteObject', () => {
  test('primitives', () => {
    expect(formatRemoteObject(str('hi'))).toBe('hi')
    expect(formatRemoteObject(num(4))).toBe('4')
    expect(formatRemoteObject({ type: 'number', unserializableValue: 'NaN' })).toBe('NaN')
    expect(formatRemoteObject({ type: 'undefined' })).toBe('undefined')
    expect(formatRemoteObject({ type: 'object', subtype: 'null', value: null })).toBe('null')
    expect(formatRemoteObject({ type: 'boolean', value: false })).toBe('false')
  })

  test('objects and arrays from their preview', () => {
    expect(
      formatRemoteObject({
        type: 'object',
        description: 'Object',
        preview: {
          properties: [
            { name: 'id', type: 'number', value: '3' },
            { name: 'name', type: 'string', value: 'Ada' }
          ]
        }
      })
    ).toBe('{id: 3, name: "Ada"}')
    expect(
      formatRemoteObject({
        type: 'object',
        subtype: 'array',
        preview: {
          subtype: 'array',
          description: 'Array(3)',
          overflow: true,
          properties: [{ name: '0', type: 'number', value: '1' }]
        }
      })
    ).toBe('Array(3) [1, …]')
  })

  test('errors and nodes by description', () => {
    expect(
      formatRemoteObject({ type: 'object', subtype: 'error', description: 'TypeError: x' })
    ).toBe('TypeError: x')
    expect(formatRemoteObject({ type: 'object', subtype: 'node', description: 'div#app' })).toBe(
      'div#app'
    )
  })
})

describe('formatConsoleArgs', () => {
  test('joins arguments with spaces', () => {
    expect(formatConsoleArgs([str('count'), num(2)])).toBe('count 2')
  })

  test('fills format specifiers and drops %c styles', () => {
    expect(formatConsoleArgs([str('%s has %d items'), str('cart'), num(3.7)])).toBe(
      'cart has 3 items'
    )
    expect(formatConsoleArgs([str('%cBig'), str('font-size: 20px')])).toBe('Big')
    expect(formatConsoleArgs([str('100%% done %s'), str('now'), num(1)])).toBe('100% done now 1')
    expect(formatConsoleArgs([str('%s and %s'), str('one')])).toBe('one and %s')
  })
})

describe('entries from CDP events', () => {
  test('console calls, with level and where they were made', () => {
    const entry = fromConsoleApiCalled({
      type: 'warning',
      args: [str('slow')],
      timestamp: at,
      stackTrace: {
        callFrames: [
          {
            functionName: 'load',
            url: 'http://localhost:5173/app.js',
            lineNumber: 9,
            columnNumber: 4
          }
        ]
      }
    })
    expect(entry).toEqual({
      time: at,
      level: 'warning',
      source: 'console',
      text: 'slow',
      frames: [{ functionName: 'load', url: 'http://localhost:5173/app.js', line: 10, column: 5 }]
    })
    expect(fromConsoleApiCalled({ type: 'log', args: [] })?.level).toBe('info')
    expect(fromConsoleApiCalled({ type: 'assert', args: [str('x > 0')] })?.text).toBe(
      'Assertion failed: x > 0'
    )
    expect(fromConsoleApiCalled({ type: 'endGroup', args: [] })).toBeNull()
  })

  test('uncaught exceptions, with the error description', () => {
    const entry = fromExceptionThrown({
      timestamp: at,
      exceptionDetails: {
        text: 'Uncaught',
        url: 'http://localhost:5173/app.js',
        lineNumber: 2,
        columnNumber: 0,
        exception: {
          type: 'object',
          subtype: 'error',
          description:
            "TypeError: Cannot read properties of undefined (reading 'x')\n    at f (app.js:3:1)"
        }
      }
    })
    expect(entry.level).toBe('error')
    expect(entry.text).toStartWith('Uncaught TypeError: Cannot read properties of undefined')
    expect(entry.frames).toEqual([
      { functionName: '', url: 'http://localhost:5173/app.js', line: 3, column: 1 }
    ])
    const thrown = fromExceptionThrown({
      exceptionDetails: { text: 'Uncaught', exception: str('just a string') }
    })
    expect(thrown.text).toBe('Uncaught just a string')
    expect(fromExceptionThrown({ exceptionDetails: { text: 'Script error.' } }).text).toBe(
      'Script error.'
    )
  })

  test('browser messages say where they come from', () => {
    const entry = fromLogEntry({
      entry: {
        source: 'network',
        level: 'error',
        text: 'Failed to load resource: 404',
        url: 'http://localhost:5173/missing.png',
        timestamp: at
      }
    })
    expect(entry).toMatchObject({
      level: 'error',
      source: 'browser',
      text: '[network] Failed to load resource: 404'
    })
    expect(entry.frames[0].url).toBe('http://localhost:5173/missing.png')
    expect(fromLogEntry({ entry: { level: 'verbose', text: 'x' } }).level).toBe('debug')
  })
})

const entry = (text: string, level: NewConsoleEntry['level'] = 'info'): NewConsoleEntry => ({
  time: at,
  level,
  source: 'console',
  text,
  frames: []
})

describe('ConsoleLog', () => {
  test('numbers entries and keeps the newest', () => {
    const log = new ConsoleLog(3)
    for (const text of ['a', 'b', 'c', 'd']) log.add(entry(text))
    const { entries, matched } = log.query()
    expect(entries.map((e) => [e.seq, e.text])).toEqual([
      [2, 'b'],
      [3, 'c'],
      [4, 'd']
    ])
    expect(matched).toBe(3)
    expect(log.lastSeq).toBe(4)
  })

  test('counts identical entries in a row', () => {
    const log = new ConsoleLog()
    log.add(entry('tick'))
    log.add(entry('tick'))
    log.add(entry('tock'))
    log.add(entry('tick'))
    expect(log.query().entries.map((e) => [e.text, e.count])).toEqual([
      ['tick', 2],
      ['tock', 1],
      ['tick', 1]
    ])
  })

  test('filters by level, seq, pattern and limit; navigations always show', () => {
    const log = new ConsoleLog()
    log.add(entry('debug noise', 'debug'))
    log.add(entry('Cart failed', 'error'))
    log.add(navigationEntry('http://localhost:5173/', at))
    log.add(entry('slow cart', 'warning'))
    log.add(entry('ok'))
    expect(log.query({ level: 'warning' }).entries.map((e) => e.text)).toEqual([
      'Cart failed',
      'Navigated to http://localhost:5173/',
      'slow cart'
    ])
    expect(log.query({ since: 3 }).entries.map((e) => e.text)).toEqual(['slow cart', 'ok'])
    expect(log.query({ pattern: 'CART', level: 'error' }).entries.map((e) => e.text)).toEqual([
      'Cart failed'
    ])
    const limited = log.query({ limit: 2 })
    expect(limited.entries.map((e) => e.seq)).toEqual([4, 5])
    expect(limited.matched).toBe(5)
    log.clear()
    expect(log.query().entries).toEqual([])
    log.add(entry('after'))
    expect(log.query().entries[0].seq).toBe(6)
  })
})

describe('formatConsoleEntry', () => {
  const frames = [
    { functionName: 'load', url: 'http://localhost:5173/app.js', line: 10, column: 5 },
    { functionName: '', url: 'http://localhost:5173/main.js', line: 2, column: 1 }
  ]

  test('header with seq, time, level and repeat count', () => {
    expect(formatConsoleEntry({ ...entry('hello'), seq: 7, count: 3 })).toBe(
      '#7 14:03:07.215 [info] (×3) hello'
    )
  })

  test('where non-errors came from, and the stack of errors', () => {
    expect(formatConsoleEntry({ ...entry('slow', 'warning'), frames, seq: 1, count: 1 })).toBe(
      '#1 14:03:07.215 [warning] slow\n    at http://localhost:5173/app.js:10:5'
    )
    expect(formatConsoleEntry({ ...entry('bad', 'error'), frames, seq: 2, count: 1 })).toBe(
      '#2 14:03:07.215 [error] bad\n' +
        '    at load (http://localhost:5173/app.js:10:5)\n' +
        '    at http://localhost:5173/main.js:2:1'
    )
  })

  test('no second stack when the text has one', () => {
    const text = 'Uncaught Error: x\n    at f (app.js:1:1)'
    expect(formatConsoleEntry({ ...entry(text, 'error'), frames, seq: 3, count: 1 })).toBe(
      `#3 14:03:07.215 [error] ${text}`
    )
  })
})

test("Electron's own warnings are not the page's: left out", () => {
  const log = new ConsoleLog()
  log.add({
    ...entry('Electron Security Warning (Insecure Content-Security-Policy)', 'warning'),
    frames: [{ functionName: '', url: 'node:electron/js2c/sandbox_bundle', line: 2, column: 1 }]
  })
  expect(log.query().entries).toEqual([])
})

describe('errors for the badge', () => {
  const exception = (text: string): NewConsoleEntry => ({
    ...entry(text, 'error'),
    source: 'exception'
  })

  test('the page’s own errors after a seq; failed loads and other levels are not counted', () => {
    const log = new ConsoleLog()
    log.add(entry('old', 'error'))
    log.add(navigationEntry('http://localhost:5173/', at))
    expect(log.pageSeq).toBe(2)
    log.add(exception('Uncaught TypeError: x'))
    log.add({ ...entry('[network] Failed to load resource: 404', 'error'), source: 'browser' })
    log.add(entry('careful', 'warning'))
    log.add(entry('console.error call', 'error'))
    expect(log.errorsAfter(log.pageSeq).map((e) => e.text)).toEqual([
      'Uncaught TypeError: x',
      'console.error call'
    ])
    expect(log.errorsAfter(log.lastSeq)).toEqual([])
  })

  test('an error repeated in a row counts as new again', () => {
    const log = new ConsoleLog()
    log.add(exception('Uncaught TypeError: x'))
    const seen = log.lastSeq
    log.add(exception('Uncaught TypeError: x'))
    expect(log.errorsAfter(seen).map((e) => [e.seq, e.count])).toEqual([[2, 2]])
    expect(log.query({ since: seen }).entries).toHaveLength(1)
  })
})

describe('source-mapped places', () => {
  const bundle = 'http://localhost:3000/assets/index.js'
  const lookup: PositionLookup = (url, line, column) =>
    url === bundle ? { source: 'src/Cart.tsx', line: line + 40, column, name: null } : null
  const frames = [
    { functionName: 'checkout', url: bundle, line: 1, column: 9 },
    { functionName: '', url: 'http://localhost:3000/vendor.js', line: 2, column: 1 }
  ]

  test('frames and stacks in the text show the original file', () => {
    expect(formatConsoleEntry({ ...entry('bad', 'error'), frames, seq: 1, count: 1 }, lookup)).toBe(
      '#1 14:03:07.215 [error] bad\n' +
        '    at checkout (src/Cart.tsx:41:9)\n' +
        '    at http://localhost:3000/vendor.js:2:1'
    )
    const text = `Uncaught Error: x\n    at checkout (${bundle}:1:9)`
    expect(formatConsoleEntry({ ...entry(text, 'error'), frames, seq: 2, count: 1 }, lookup)).toBe(
      '#2 14:03:07.215 [error] Uncaught Error: x\n    at checkout (src/Cart.tsx:41:9)'
    )
  })

  test('positionsOf: every frame and every place in the text', () => {
    const text = `Error\n    at f (${bundle}:3:4)`
    expect(positionsOf([{ ...entry(text, 'error'), frames, seq: 1, count: 1 }])).toEqual([
      { url: bundle, line: 1, column: 9 },
      { url: 'http://localhost:3000/vendor.js', line: 2, column: 1 },
      { url: bundle, line: 3, column: 4 }
    ])
  })
})
