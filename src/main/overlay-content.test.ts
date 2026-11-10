import { describe, expect, test } from 'bun:test'
import { SHADOW_ROOM } from '../shared/overlay'
import type { AgentState } from '../shared/types'
import type { ConsoleEntry } from './console-log'
import {
  bridgeStatus,
  connectTexts,
  errorRows,
  backdropRegions,
  menuMaxHeight,
  overlayBounds,
  permissionIcon,
  pointerMenuRect,
  popoverRect,
  sheetRect,
  sheetUrl,
  TOKEN_MASK
} from './overlay-content'

const agent = (change: Partial<AgentState>): AgentState => ({
  enabled: true,
  port: 9339,
  error: null,
  shareAll: false,
  working: null,
  picking: null,
  pick: null,
  ...change
})

test('bridgeStatus: off, starting, listening or failed', () => {
  expect(bridgeStatus(agent({ enabled: false, port: null }))).toBe('off')
  expect(bridgeStatus(agent({ port: null }))).toBe('starting')
  expect(bridgeStatus(agent({}))).toBe('listening')
  expect(bridgeStatus(agent({ port: null, error: 'EADDRINUSE' }))).toBe('error')
})

test('connectTexts masks the token everywhere it appears', () => {
  const token = 'secret-token-123'
  const { command, config } = connectTexts(9339, token)
  expect(command).not.toContain(token)
  expect(config).not.toContain(token)
  expect(command).toContain(`Bearer ${TOKEN_MASK}`)
  expect(command).toContain('http://127.0.0.1:9339/mcp')
  expect(JSON.parse(config).mcpServers.browminal.headers.Authorization).toBe(`Bearer ${TOKEN_MASK}`)
})

test('sheetUrl shows web addresses without their scheme', () => {
  expect(sheetUrl('http://localhost:5173/checkout?step=2')).toBe('localhost:5173/checkout?step=2')
  expect(sheetUrl('https://example.com/')).toBe('example.com')
  expect(sheetUrl('browminal://home/')).toBe('browminal://home')
  expect(sheetUrl('not a url')).toBe('not a url')
})

const entry = (change: Partial<ConsoleEntry>): ConsoleEntry => ({
  seq: 1,
  time: 0,
  level: 'error',
  source: 'exception',
  text: 'Error',
  frames: [],
  count: 1,
  ...change
})

describe('errorRows', () => {
  const noLookup = (): null => null

  test('lists the newest first, with the first line and a short place', () => {
    const rows = errorRows(
      [
        entry({ seq: 1, text: 'old' }),
        entry({
          seq: 2,
          text: "TypeError: Cannot read properties of undefined (reading 'total')\n    at cart.ts",
          frames: [
            {
              functionName: 'total',
              url: 'http://localhost:5173/src/cart.ts?t=12',
              line: 48,
              column: 3
            }
          ],
          count: 2
        })
      ],
      noLookup
    )
    expect(rows[0]).toEqual({
      message: "TypeError: Cannot read properties of undefined (reading 'total')",
      place: 'cart.ts:48',
      count: 2
    })
    expect(rows[1].message).toBe('old')
    expect(rows[1].place).toBeNull()
  })

  test('names the original file when a source map knows it', () => {
    const rows = errorRows(
      [
        entry({
          frames: [{ functionName: '', url: 'http://x/assets/index-abc.js', line: 1, column: 900 }]
        })
      ],
      () => ({ source: 'src/components/OrderSummary.tsx', line: 21, column: 4, name: null })
    )
    expect(rows[0].place).toBe('OrderSummary.tsx:21')
  })

  test('keeps only the newest few and cuts long messages', () => {
    const entries = Array.from({ length: 5 }, (_, i) => entry({ seq: i, text: `e${i}` }))
    expect(errorRows(entries, noLookup).map((row) => row.message)).toEqual(['e4', 'e3', 'e2'])
    const long = errorRows([entry({ text: 'x'.repeat(1000) })], noLookup)[0].message
    expect(long.length).toBeLessThan(310)
    expect(long.endsWith('…')).toBe(true)
  })
})

test('permissionIcon follows the first thing asked for', () => {
  expect(permissionIcon(['camera', 'microphone'])).toBe('camera')
  expect(permissionIcon(['clipboard-read'])).toBe('clipboard')
  expect(permissionIcon(['location'])).toBe('location')
})

describe('placement', () => {
  test('popoverRect hangs from its anchor and stays inside the window', () => {
    expect(popoverRect({ x: 900, y: 80, align: 'right' }, 380, 200, 1100, 700)).toEqual({
      x: 520,
      y: 80,
      width: 380,
      height: 200
    })
    // Too far right: pulled back in, 8px from the edge.
    expect(popoverRect({ x: 900, y: 80, align: 'left' }, 360, 200, 1100, 700).x).toBe(732)
    // Too tall for the window: cut to fit.
    expect(popoverRect({ x: 10, y: 600, align: 'left' }, 360, 400, 1100, 700).height).toBe(92)
  })

  test('sheetRect sits at the page’s top right, as tall as its content', () => {
    expect(sheetRect({ x: 8, y: 84, width: 1084, height: 608 }, 360, 420)).toEqual({
      x: 8 + 1084 - 4 - 360,
      y: 88,
      width: 360,
      height: 420
    })
    // Taller than the page: cut to fit (its content scrolls).
    expect(sheetRect({ x: 8, y: 84, width: 1084, height: 608 }, 360, 900).height).toBe(600)
    // A narrow page: the sheet narrows with it.
    expect(sheetRect({ x: 8, y: 84, width: 300, height: 400 }, 360, 300).width).toBe(292)
  })

  test('overlayBounds leaves room for the shadow, inside the window', () => {
    const { bounds, inset } = overlayBounds({ x: 500, y: 80, width: 380, height: 200 }, 1100, 700)
    expect(bounds).toEqual({
      x: 500 - SHADOW_ROOM.side,
      y: 80 - SHADOW_ROOM.top,
      width: 380 + 2 * SHADOW_ROOM.side,
      height: 200 + SHADOW_ROOM.top + SHADOW_ROOM.bottom
    })
    expect(inset).toEqual({ top: SHADOW_ROOM.top, left: SHADOW_ROOM.side })
    const edge = overlayBounds({ x: 4, y: 0, width: 300, height: 690 }, 1100, 700)
    expect(edge.bounds.x).toBe(0)
    expect(edge.inset.left).toBe(4)
    expect(edge.bounds.y + edge.bounds.height).toBe(700)
  })

  test('backdropRegions takes what lies under the surface, view by view', () => {
    const surface = { x: 500, y: 60, width: 300, height: 200 }
    const ui = { x: 0, y: 0, width: 1100, height: 700 }
    const page = { x: 8, y: 84, width: 1084, height: 608 }
    const offScreen = { x: -2000, y: 0, width: 100, height: 100 }
    expect(backdropRegions(surface, [ui, page, offScreen], 10)).toEqual([
      { view: 0, capture: { x: 490, y: 50, width: 320, height: 220 }, x: -10, y: -10 },
      { view: 1, capture: { x: 482, y: 0, width: 320, height: 186 }, x: -10, y: 24 }
    ])
  })

  test('pointerMenuRect opens at the pointer, flipping where it wouldn’t fit', () => {
    expect(pointerMenuRect({ x: 100, y: 100 }, 240, 200, 1100, 700)).toEqual({
      x: 100,
      y: 100,
      width: 240,
      height: 200
    })
    // Near the right and bottom edges: to the left of and above the pointer.
    expect(pointerMenuRect({ x: 1000, y: 600 }, 240, 200, 1100, 700)).toEqual({
      x: 760,
      y: 400,
      width: 240,
      height: 200
    })
    // Taller than the window: cut to fit, from the top.
    expect(pointerMenuRect({ x: 100, y: 300 }, 240, 900, 1100, 700)).toEqual({
      x: 100,
      y: 8,
      width: 240,
      height: 684
    })
  })

  test('menuMaxHeight leaves the window’s edges free', () => {
    expect(menuMaxHeight('pointer', 300, 700)).toBe(684)
    expect(menuMaxHeight('anchor', 80, 700)).toBe(612)
  })
})
