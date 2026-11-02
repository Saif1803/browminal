import { describe, expect, test } from 'bun:test'
import {
  clampTerminalHeight,
  MIN_PAGE_HEIGHT,
  PAGE_INSET,
  TERMINAL_HEADER_HEIGHT,
  TERMINAL_MIN_HEIGHT,
  windowLayout
} from './layout'

describe('windowLayout', () => {
  test('without the panel the page fills the window below the UI, inset', () => {
    expect(windowLayout(1000, 800, 80, null)).toEqual({
      page: { x: PAGE_INSET, y: 80, width: 1000 - 2 * PAGE_INSET, height: 800 - 80 - PAGE_INSET },
      panel: null,
      terminal: null
    })
  })

  test('the panel sits at the bottom, the terminal below its header, the page above it', () => {
    const { page, panel, terminal } = windowLayout(1000, 800, 80, 300)
    expect(panel).toEqual({ x: 8, y: 800 - 8 - 300, width: 984, height: 300 })
    expect(terminal).toEqual({
      x: 8,
      y: panel!.y + TERMINAL_HEADER_HEIGHT,
      width: 984,
      height: 300 - TERMINAL_HEADER_HEIGHT
    })
    expect(page).toEqual({ x: 8, y: 80, width: 984, height: panel!.y - 8 - 80 })
  })

  test('the page keeps its minimum when the panel is dragged too tall', () => {
    const { page } = windowLayout(1000, 800, 80, 5000)
    expect(page.height).toBe(MIN_PAGE_HEIGHT)
  })
})

test('clampTerminalHeight keeps the panel between its minimum and what the window allows', () => {
  expect(clampTerminalHeight(10, 800, 80)).toBe(TERMINAL_MIN_HEIGHT)
  expect(clampTerminalHeight(300.4, 800, 80)).toBe(300)
  expect(clampTerminalHeight(9999, 800, 80)).toBe(800 - 80 - MIN_PAGE_HEIGHT - 2 * PAGE_INSET)
  // A tiny window still gets the minimum panel; the page gives way.
  expect(clampTerminalHeight(300, 200, 80)).toBe(TERMINAL_MIN_HEIGHT)
})
