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
/** The page keeps at least this much height however tall the panel is dragged. */
export const MIN_PAGE_HEIGHT = 120

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The panel's height (header included) for a window `windowHeight` tall. */
export function clampTerminalHeight(
  px: number,
  windowHeight: number,
  chromeHeight: number
): number {
  const max = windowHeight - chromeHeight - MIN_PAGE_HEIGHT - 2 * PAGE_INSET
  return Math.round(Math.min(Math.max(px, TERMINAL_MIN_HEIGHT), Math.max(TERMINAL_MIN_HEIGHT, max)))
}

/**
 * Where things go in the window's content area: the page below the UI, and with the terminal
 * panel open (`panelHeight` not null) the panel under it, inset like the page. The panel's top
 * TERMINAL_HEADER_HEIGHT px is the UI's header row; the terminal view fills the rest.
 */
export function windowLayout(
  width: number,
  height: number,
  chromeHeight: number,
  panelHeight: number | null
): { page: Rect; panel: Rect | null; terminal: Rect | null } {
  const innerWidth = Math.max(0, width - 2 * PAGE_INSET)
  if (panelHeight === null) {
    const page = {
      x: PAGE_INSET,
      y: chromeHeight,
      width: innerWidth,
      height: Math.max(0, height - chromeHeight - PAGE_INSET)
    }
    return { page, panel: null, terminal: null }
  }
  const panelH = clampTerminalHeight(panelHeight, height, chromeHeight)
  const panel = {
    x: PAGE_INSET,
    y: height - PAGE_INSET - panelH,
    width: innerWidth,
    height: panelH
  }
  const page = {
    x: PAGE_INSET,
    y: chromeHeight,
    width: innerWidth,
    height: Math.max(0, panel.y - PAGE_INSET - chromeHeight)
  }
  const terminal = {
    x: PAGE_INSET,
    y: panel.y + TERMINAL_HEADER_HEIGHT,
    width: innerWidth,
    height: Math.max(0, panelH - TERMINAL_HEADER_HEIGHT)
  }
  return { page, panel, terminal }
}
