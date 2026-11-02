import { describe, expect, test } from 'bun:test'
import {
  clampPanelSize,
  isPanelDock,
  MIN_PAGE_HEIGHT,
  MIN_PAGE_WIDTH,
  PAGE_INSET,
  panelPlacement,
  TERMINAL_HEADER_HEIGHT,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
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

  test('docked at the bottom: the panel under the page, the terminal below its header', () => {
    const { page, panel, terminal } = windowLayout(1000, 800, 80, { dock: 'bottom', size: 300 })
    expect(panel).toEqual({ x: 8, y: 800 - 8 - 300, width: 984, height: 300 })
    expect(terminal).toEqual({
      x: 8,
      y: panel!.y + TERMINAL_HEADER_HEIGHT,
      width: 984,
      height: 300 - TERMINAL_HEADER_HEIGHT
    })
    expect(page).toEqual({ x: 8, y: 80, width: 984, height: panel!.y - 8 - 80 })
  })

  test('docked on the right: the panel beside the page, full height', () => {
    const { page, panel, terminal } = windowLayout(1000, 800, 80, { dock: 'right', size: 400 })
    expect(panel).toEqual({ x: 1000 - 8 - 400, y: 80, width: 400, height: 800 - 80 - 8 })
    expect(terminal).toEqual({
      x: panel!.x,
      y: 80 + TERMINAL_HEADER_HEIGHT,
      width: 400,
      height: panel!.height - TERMINAL_HEADER_HEIGHT
    })
    expect(page).toEqual({ x: 8, y: 80, width: panel!.x - 16, height: panel!.height })
  })

  test('the page keeps its minimum when the panel is dragged too big', () => {
    expect(windowLayout(1000, 800, 80, { dock: 'bottom', size: 5000 }).page.height).toBe(
      MIN_PAGE_HEIGHT
    )
    expect(windowLayout(1000, 800, 80, { dock: 'right', size: 5000 }).page.width).toBe(
      MIN_PAGE_WIDTH
    )
  })
})

describe('clampPanelSize', () => {
  test('keeps a bottom panel between its minimum and what the window allows', () => {
    expect(clampPanelSize(10, 'bottom', 1000, 800, 80)).toBe(TERMINAL_MIN_HEIGHT)
    expect(clampPanelSize(300.4, 'bottom', 1000, 800, 80)).toBe(300)
    expect(clampPanelSize(9999, 'bottom', 1000, 800, 80)).toBe(
      800 - 80 - MIN_PAGE_HEIGHT - 2 * PAGE_INSET
    )
    // A tiny window still gets the minimum panel; the page gives way.
    expect(clampPanelSize(300, 'bottom', 1000, 200, 80)).toBe(TERMINAL_MIN_HEIGHT)
  })

  test('keeps a right panel between its minimum and what the window allows', () => {
    expect(clampPanelSize(10, 'right', 1000, 800, 80)).toBe(TERMINAL_MIN_WIDTH)
    expect(clampPanelSize(450.6, 'right', 1000, 800, 80)).toBe(451)
    expect(clampPanelSize(9999, 'right', 1000, 800, 80)).toBe(
      1000 - MIN_PAGE_WIDTH - 3 * PAGE_INSET
    )
    expect(clampPanelSize(400, 'right', 400, 800, 80)).toBe(TERMINAL_MIN_WIDTH)
  })
})

test('isPanelDock accepts only the two docks', () => {
  expect(isPanelDock('bottom')).toBe(true)
  expect(isPanelDock('right')).toBe(true)
  expect(isPanelDock('left')).toBe(false)
  expect(isPanelDock(undefined)).toBe(false)
})

test('panelPlacement takes the size its dock remembers', () => {
  expect(panelPlacement({ dock: 'bottom', height: 300, width: 500 })).toEqual({
    dock: 'bottom',
    size: 300
  })
  expect(panelPlacement({ dock: 'right', height: 300, width: 500 })).toEqual({
    dock: 'right',
    size: 500
  })
})
