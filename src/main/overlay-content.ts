import type { Rect } from '../shared/layout'
import type { BridgeStatus, ErrorRow, PromptIcon } from '../shared/overlay'
import { SHADOW_ROOM } from '../shared/overlay'
import type { AgentState } from '../shared/types'
import { isHomeUrl } from '../shared/url'
import { claudeAddCommand, mcpConfigJson } from './agent-policy'
import type { ConsoleEntry } from './console-log'
import type { PermissionKind } from './permission-policy'
import type { PositionLookup } from './source-maps'

/** The bridge as the agent sheet's header says it. */
export function bridgeStatus(agent: AgentState): BridgeStatus {
  if (!agent.enabled) return 'off'
  if (agent.error) return 'error'
  return agent.port === null ? 'starting' : 'listening'
}

/** What the sheet shows in place of the token: the copy has the real one. */
export const TOKEN_MASK = '••••••••'

/** The command and the JSON to connect a client, as the sheet shows them (token masked). */
export function connectTexts(port: number, token: string): { command: string; config: string } {
  const mask = (text: string): string => text.split(token).join(TOKEN_MASK)
  return { command: mask(claudeAddCommand(port, token)), config: mask(mcpConfigJson(port, token)) }
}

/** The tab's address as the sheet shows it: no scheme or trailing slash for the web. */
export function sheetUrl(url: string): string {
  if (isHomeUrl(url)) return 'browminal://home'
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.host}${path}${parsed.search}`
  } catch {
    return url
  }
}

const MAX_MESSAGE = 300
/** The errors popover shows the newest few; the badge counts them all. */
export const MAX_ERROR_ROWS = 3

/** The last part of a path or URL, without its query: "src/cart.ts?t=1" → "cart.ts". */
function fileName(path: string): string {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '')
  return clean.slice(clean.lastIndexOf('/') + 1) || clean
}

/** Where an entry comes from, short: its first stack frame, original file when mapped. */
function placeOf(entry: ConsoleEntry, lookup: PositionLookup): string | null {
  const frame = entry.frames[0]
  if (!frame) return null
  const original = lookup(frame.url, frame.line, frame.column)
  if (original) return `${fileName(original.source)}:${original.line}`
  const name = fileName(frame.url)
  return name ? `${name}:${frame.line}` : null
}

/** The newest `max` errors as the popover lists them, newest first. */
export function errorRows(
  entries: readonly ConsoleEntry[],
  lookup: PositionLookup,
  max = MAX_ERROR_ROWS
): ErrorRow[] {
  return entries
    .slice(-max)
    .reverse()
    .map((entry) => {
      const line = entry.text.split('\n', 1)[0].trim() || entry.text.trim()
      const message = line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE)}…` : line
      return { message, place: placeOf(entry, lookup), count: entry.count }
    })
}

/** The icon of a permission prompt: the first thing asked for. */
export function permissionIcon(kinds: readonly PermissionKind[]): PromptIcon {
  const kind = kinds[0]
  if (kind === 'clipboard-read') return 'clipboard'
  return kind ?? 'notifications'
}

/** Gap between a surface and the window's edges. */
const EDGE = 8

/**
 * A popover's surface: `width` wide, hanging from (x, y). `align: 'left'` puts its left edge at
 * x, 'right' its right edge. Kept inside the window.
 */
export function popoverRect(
  anchor: { x: number; y: number; align: 'left' | 'right' },
  width: number,
  height: number,
  windowWidth: number,
  windowHeight: number
): Rect {
  const left = anchor.align === 'left' ? anchor.x : anchor.x - width
  const x = Math.round(Math.max(EDGE, Math.min(left, windowWidth - EDGE - width)))
  const y = Math.round(Math.max(0, anchor.y))
  return { x, y, width, height: Math.max(0, Math.min(height, windowHeight - EDGE - y)) }
}

/**
 * A menu opened at the pointer (right-click): its top-left corner at (x, y), flipped left or up
 * where it wouldn't fit, and kept inside the window.
 */
export function pointerMenuRect(
  point: { x: number; y: number },
  width: number,
  height: number,
  windowWidth: number,
  windowHeight: number
): Rect {
  const h = Math.max(0, Math.min(height, windowHeight - 2 * EDGE))
  const left = point.x + width > windowWidth - EDGE ? point.x - width : point.x
  const top = point.y + h > windowHeight - EDGE ? point.y - h : point.y
  const x = Math.round(Math.max(EDGE, Math.min(left, windowWidth - EDGE - width)))
  const y = Math.round(Math.max(EDGE, Math.min(top, windowHeight - EDGE - h)))
  return { x, y, width, height: h }
}

/** The tallest a menu may be before it scrolls: opened at the pointer, or hanging from (x, y). */
export function menuMaxHeight(at: 'pointer' | 'anchor', y: number, windowHeight: number): number {
  return Math.max(0, at === 'pointer' ? windowHeight - 2 * EDGE : windowHeight - EDGE - y)
}

/**
 * The agent sheet: at the page's top right, inset a little, as tall as its content (`height`)
 * but never taller than the page.
 */
export function sheetRect(page: Rect, width: number, height: number): Rect {
  const inset = 4
  const w = Math.min(width, Math.max(0, page.width - 2 * inset))
  return {
    x: page.x + page.width - inset - w,
    y: page.y + inset,
    width: w,
    height: Math.max(0, Math.min(height, page.height - 2 * inset))
  }
}

/**
 * The view around a surface: room for its shadow on every side (kept inside the window), and
 * where the surface sits inside it.
 */
export function overlayBounds(
  surface: Rect,
  windowWidth: number,
  windowHeight: number
): { bounds: Rect; inset: { top: number; left: number } } {
  const x = Math.max(0, surface.x - SHADOW_ROOM.side)
  const y = Math.max(0, surface.y - SHADOW_ROOM.top)
  const right = Math.min(windowWidth, surface.x + surface.width + SHADOW_ROOM.side)
  const bottom = Math.min(windowHeight, surface.y + surface.height + SHADOW_ROOM.bottom)
  return {
    bounds: { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) },
    inset: { top: surface.y - y, left: surface.x - x }
  }
}

/** How far past the surface its frosted backdrop is captured, so the blur's edges stay full. */
export const BACKDROP_MARGIN = 48

/** One capture for a surface's backdrop: a part of one view, and where it lands. */
export interface BackdropRegion {
  /** Index into the views given. */
  view: number
  /** The part to capture, in that view's own coordinates. */
  capture: Rect
  /** Where it goes, relative to the surface's top-left corner. */
  x: number
  y: number
}

/**
 * What lies under a surface (and its margin), view by view: `views` are window rects, back to
 * front; the views the area doesn't touch are left out.
 */
export function backdropRegions(
  surface: Rect,
  views: readonly Rect[],
  margin = BACKDROP_MARGIN
): BackdropRegion[] {
  const left = surface.x - margin
  const top = surface.y - margin
  const right = surface.x + surface.width + margin
  const bottom = surface.y + surface.height + margin
  const regions: BackdropRegion[] = []
  views.forEach((view, index) => {
    const x = Math.max(left, view.x)
    const y = Math.max(top, view.y)
    const width = Math.min(right, view.x + view.width) - x
    const height = Math.min(bottom, view.y + view.height) - y
    if (width <= 0 || height <= 0) return
    regions.push({
      view: index,
      capture: { x: x - view.x, y: y - view.y, width, height },
      x: x - surface.x,
      y: y - surface.y
    })
  })
  return regions
}
