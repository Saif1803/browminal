import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { truncate } from './agent-policy'
import { callOn, DESCRIBE_ELEMENT } from './agent-page-tools'
import { text, type AgentContext } from './agent-tool-helpers'
import type { CdpSession } from './cdp'
import {
  appFrame,
  COMPONENT_SOURCE,
  formatComponentSource,
  parseComponentSource
} from './component-source'
import { formatConsoleEntries } from './console-log'
import { formatBoxModel, formatComputed, shiftBoxModel, type BoxModel } from './element-inspect'
import { formatPick, formatPickLine, type NewPick } from './picks'
import type { TabDebug } from './tab-debug'
import type { Tab } from './tabs'

const PICK_HTML_CHARS = 3000
const MAX_PICK_ERRORS = 30
const MAX_ERRORS_TEXT = 30_000
// The pick's screenshot: the element and this much around it, at most this wide and tall.
const IMAGE_MARGIN = 8
const IMAGE_MAX_WIDTH = 800
const IMAGE_MAX_HEIGHT = 1200
const JPEG_QUALITY = 80

/** The computed styles a pick shows; inspect(ref) has the rest and the rules behind them. */
const PICK_STYLES = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'border',
  'border-radius',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'opacity',
  'z-index'
]

/** A CSS selector for the element: by id where one is unique, else a path of nth-of-type steps. */
const SELECTOR = `function () {
  const esc = (s) => CSS.escape(s)
  const unique = (selector) => {
    try { return document.querySelectorAll(selector).length === 1 } catch { return false }
  }
  const steps = []
  for (let el = this; el && el.nodeType === Node.ELEMENT_NODE; el = el.parentElement) {
    if (el.id && unique('#' + esc(el.id))) { steps.unshift('#' + esc(el.id)); break }
    let step = el.localName
    const parent = el.parentElement
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.localName === el.localName)
      if (same.length > 1) step += ':nth-of-type(' + (same.indexOf(el) + 1) + ')'
    }
    steps.unshift(step)
    if (steps.length >= 12 || el.localName === 'body') break
  }
  return steps.join(' > ')
}`

const COMPUTED = `function (names) {
  const style = getComputedStyle(this)
  return names.map((name) => ({ name, value: style.getPropertyValue(name) }))
}`

/** Where element `ref` is written, from its framework's dev info and the page's source maps. */
export async function elementSource(
  cdp: CdpSession,
  debug: TabDebug,
  ref: number
): Promise<string | null> {
  let raw: unknown
  try {
    raw = await callOn<unknown>(cdp, ref, COMPONENT_SOURCE)
  } catch (error) {
    if (cdp.dialog) throw error
    return null
  }
  const source = parseComponentSource(raw)
  if (!source) return null
  const frame = source.file || !source.stack ? null : appFrame(source.stack)
  const original = frame ? await debug.sourceMaps.resolve(frame) : null
  return formatComponentSource(source, original, frame)
}

/** A JPEG of the element (border box plus a margin), or null when it has no size on screen. */
async function screenshotOf(cdp: CdpSession, model: BoxModel | null): Promise<string | null> {
  if (!model) return null
  const xs = [model.border[0], model.border[2], model.border[4], model.border[6]]
  const ys = [model.border[1], model.border[3], model.border[5], model.border[7]]
  const left = Math.min(...xs) - IMAGE_MARGIN
  const top = Math.min(...ys) - IMAGE_MARGIN
  const width = Math.max(...xs) + IMAGE_MARGIN - left
  const height = Math.min(Math.max(...ys) + IMAGE_MARGIN - top, IMAGE_MAX_HEIGHT)
  if (width < 1 || height < 1) return null
  // The box is in viewport coordinates, the clip in the page's: add the scroll position.
  const { cssVisualViewport } = await cdp.send<{
    cssVisualViewport: { pageX: number; pageY: number }
  }>('Page.getLayoutMetrics')
  const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', {
    format: 'jpeg',
    quality: JPEG_QUALITY,
    clip: {
      x: Math.max(0, cssVisualViewport.pageX + left),
      y: Math.max(0, cssVisualViewport.pageY + top),
      width,
      height,
      scale: Math.min(1, IMAGE_MAX_WIDTH / width)
    }
  })
  return data
}

/** Everything an agent gets about an element the user picked. */
export async function captureElementPick(tab: Tab, debug: TabDebug, ref: number): Promise<NewPick> {
  const { cdp } = debug
  // It may be in a frame of another process: its session has the node.
  const { session, node, frame } = cdp.at(ref)
  const description = await callOn<string>(cdp, ref, DESCRIBE_ELEMENT)
  const selector = await callOn<string>(cdp, ref, SELECTOR).catch(() => '')
  const { outerHTML } = await session.send<{ outerHTML: string }>('DOM.getOuterHTML', {
    backendNodeId: node
  })
  const model = await session
    .send<{ model: BoxModel }>('DOM.getBoxModel', { backendNodeId: node })
    .then(async ({ model }) => {
      const { x, y } = await cdp.frameOffset(frame)
      return shiftBoxModel(model, x, y)
    })
    .catch(() => null)
  const computed = await callOn<{ name: string; value: string }[]>(cdp, ref, COMPUTED, [
    PICK_STYLES
  ]).catch(() => [])
  const source = await elementSource(cdp, debug, ref)
  const image = await screenshotOf(cdp, model).catch(() => null)
  const { title, url } = tab.getSummary()
  return {
    kind: 'element',
    tabId: tab.id,
    url,
    title,
    time: Date.now(),
    ref,
    description,
    selector,
    html: truncate(outerHTML, PICK_HTML_CHARS),
    box: model ? formatBoxModel(model) : null,
    styles: formatComputed(computed, PICK_STYLES),
    source,
    image
  }
}

/** The page's new errors (see TabDebug.newErrors) as a pick, or null when there are none. */
export async function captureErrorsPick(tab: Tab, debug: TabDebug): Promise<NewPick | null> {
  const errors = debug.newErrors
  if (errors.length === 0) return null
  const shown = errors.slice(-MAX_PICK_ERRORS)
  const body = await formatConsoleEntries(shown, debug.sourceMaps)
  const { title, url } = tab.getSummary()
  return {
    kind: 'errors',
    tabId: tab.id,
    url,
    title,
    time: Date.now(),
    count: errors.length,
    errors:
      (shown.length < errors.length ? `(the newest ${shown.length})\n` : '') +
      truncate(body, MAX_ERRORS_TEXT)
  }
}

/** get_picks: what the user sent the agent from a page. */
export function registerPickTools(mcp: McpServer, context: AgentContext): void {
  mcp.registerTool(
    'get_picks',
    {
      description:
        'What the user picked in Browminal to show you. An element (picked with Ctrl+Shift+X, or ' +
        'right-click → "Send to agent"): its ref, a selector, HTML, box, styles, the file and ' +
        'line it is written at (React, Vue and Svelte dev builds) and a screenshot of it. Or a ' +
        'page’s errors (from the errors badge), mapped to the source files. When the user ' +
        'mentions "pick 3" or "the element I picked", read it here. Without id: the list and ' +
        'the newest in full.',
      inputSchema: {
        id: z.number().int().positive().optional().describe('The pick’s number')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ id }) => {
      const picks = context.picks()
      const pick = id === undefined ? picks.latest : picks.get(id)
      if (!pick) {
        if (id !== undefined && id <= picks.lastId) {
          throw new Error(`Pick ${id} is gone: Browminal keeps the newest ${picks.all.length}.`)
        }
        return text(
          id === undefined
            ? 'The user hasn’t picked anything yet. They pick an element with Ctrl+Shift+X ' +
                '(or right-click → "Send to agent") in a page.'
            : `There is no pick ${id} yet.`
        )
      }
      const parts: string[] = []
      if (id === undefined && picks.all.length > 1) {
        parts.push(`Picks, oldest first:\n${picks.all.map(formatPickLine).join('\n')}\n`)
      }
      parts.push(formatPick(pick))
      const content: (
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
      )[] = [{ type: 'text', text: parts.join('\n') }]
      if (pick.kind === 'element' && pick.image) {
        content.push({ type: 'image', data: pick.image, mimeType: 'image/jpeg' })
      }
      return { content }
    }
  )
}
