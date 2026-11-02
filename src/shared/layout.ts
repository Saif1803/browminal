/** Height of the tab strip, the UI's top row. The native window controls are drawn this tall. */
export const TAB_STRIP_HEIGHT = 40

/** Where tabs are placed until the UI reports its real height with setChromeHeight. */
export const INITIAL_CHROME_HEIGHT = TAB_STRIP_HEIGHT + 40

/** setChromeHeight rejects anything taller. */
export const MAX_CHROME_HEIGHT = 400

/** Gap between the page and the window's left, right and bottom edges; the glass shows through. */
export const PAGE_INSET = 8

/** Corner radius of the page. */
export const PAGE_RADIUS = 10

/** The terminal panel's header row (drawn by the UI), above the terminal view. */
export const TERMINAL_HEADER_HEIGHT = 34
export const TERMINAL_DEFAULT_HEIGHT = 300
export const TERMINAL_MIN_HEIGHT = 120
export const TERMINAL_DEFAULT_WIDTH = 520
export const TERMINAL_MIN_WIDTH = 300
/** The page keeps at least this much room however big the panel is dragged. */
export const MIN_PAGE_HEIGHT = 120
export const MIN_PAGE_WIDTH = 320

/** Where the terminal panel sits: under the page (horizontal split) or beside it (vertical). */
export type PanelDock = 'bottom' | 'right'

export const PANEL_DOCKS: readonly PanelDock[] = ['bottom', 'right']

export const isPanelDock = (value: unknown): value is PanelDock =>
  PANEL_DOCKS.includes(value as PanelDock)

/** The open panel: its dock and its size across it (height at the bottom, width on the right). */
export interface PanelPlacement {
  dock: PanelDock
  size: number
}

/** Where the open panel goes: its dock, with the size remembered for that dock. */
export function panelPlacement(panel: {
  dock: PanelDock
  height: number
  width: number
}): PanelPlacement {
  return { dock: panel.dock, size: panel.dock === 'bottom' ? panel.height : panel.width }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The panel's size (header included) along its dock's axis for a `windowWidth` × `windowHeight`
 * window: at least its minimum, and at most what leaves the page its own.
 */
export function clampPanelSize(
  px: number,
  dock: PanelDock,
  windowWidth: number,
  windowHeight: number,
  chromeHeight: number
): number {
  const [min, max] =
    dock === 'bottom'
      ? [TERMINAL_MIN_HEIGHT, windowHeight - chromeHeight - MIN_PAGE_HEIGHT - 2 * PAGE_INSET]
      : [TERMINAL_MIN_WIDTH, windowWidth - MIN_PAGE_WIDTH - 3 * PAGE_INSET]
  return Math.round(Math.min(Math.max(px, min), Math.max(min, max)))
}

/**
 * Where things go in the window's content area: the page below the UI, and with the terminal
 * panel open (`panel` not null) the panel under it or to its right, inset like the page. The
 * panel's top TERMINAL_HEADER_HEIGHT px is the UI's header row; the terminal view fills the rest.
 */
export function windowLayout(
  width: number,
  height: number,
  chromeHeight: number,
  placement: PanelPlacement | null
): { page: Rect; panel: Rect | null; terminal: Rect | null } {
  const innerWidth = Math.max(0, width - 2 * PAGE_INSET)
  const innerHeight = Math.max(0, height - chromeHeight - PAGE_INSET)
  if (placement === null) {
    const page = { x: PAGE_INSET, y: chromeHeight, width: innerWidth, height: innerHeight }
    return { page, panel: null, terminal: null }
  }
  const size = clampPanelSize(placement.size, placement.dock, width, height, chromeHeight)
  let page: Rect
  let panel: Rect
  if (placement.dock === 'bottom') {
    panel = { x: PAGE_INSET, y: height - PAGE_INSET - size, width: innerWidth, height: size }
    page = {
      x: PAGE_INSET,
      y: chromeHeight,
      width: innerWidth,
      height: Math.max(0, panel.y - PAGE_INSET - chromeHeight)
    }
  } else {
    panel = { x: width - PAGE_INSET - size, y: chromeHeight, width: size, height: innerHeight }
    page = {
      x: PAGE_INSET,
      y: chromeHeight,
      width: Math.max(0, panel.x - 2 * PAGE_INSET),
      height: innerHeight
    }
  }
  const terminal = {
    x: panel.x,
    y: panel.y + TERMINAL_HEADER_HEIGHT,
    width: panel.width,
    height: Math.max(0, panel.height - TERMINAL_HEADER_HEIGHT)
  }
  return { page, panel, terminal }
}
