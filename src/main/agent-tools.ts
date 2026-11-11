import { nativeImage, type NativeImage } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { isHttpUrl, resolveInput } from '../shared/url'
import { describeTabs, formatValue, MAX_AGENT_TEXT, scaledSize, truncate } from './agent-policy'
import { registerDebugTools } from './agent-debug-tools'
import { registerPageTools } from './agent-page-tools'
import { registerPickTools } from './agent-picks'
import {
  AGENT_WORLD_ID,
  assertInspectable,
  describeLoad,
  tabIdInput,
  text,
  waitForLoad,
  type AgentContext
} from './agent-tool-helpers'
import type { CdpSession } from './cdp'
import type { Tab } from './tabs'

export type { AgentContext } from './agent-tool-helpers'

const DEFAULT_SCREENSHOT_WIDTH = 1280
// Chromium can't capture a taller texture than this in one go.
const MAX_FULL_PAGE_HEIGHT = 16_384
const JPEG_QUALITY = 80

const INSTRUCTIONS = `Browminal is the user's own web browser. These tools act on its tabs.
- You only see tabs the user shared with agents, and tabs you opened with new_tab.
- Tools take an optional tabId (from list_tabs); without one they act on the tab you used last,
  the tab of the Browminal terminal you run in, or the active shared tab.
- To act on a page: read_page (or find) gives each element a ref; pass it to click, type, fill,
  select_option, press_key, hover or scroll. Refs go stale when the page changes: read again.
- get_page_text is the cheapest way to read a page; screenshot shows its layout.
- evaluate runs JavaScript in the page itself, like the DevTools console (top-level await works).
- If an action opens an alert/confirm/prompt, answer it with handle_dialog.
- To debug like DevTools: console_messages (errors with stacks), network_requests and
  network_request (status, headers, bodies), inspect(ref) (box, computed styles, the CSS rules
  with file and line), set_style/set_attribute to try a fix live, emulate (phone, dark mode,
  offline). Pass the last #seq/#id you saw as since to read only what is new.
- Errors, stack traces and CSS rules are shown in the original source files where the page
  has source maps (a dev server's src/App.tsx:12:5, not the bundle); inspect also says which
  file and line an element is written at in React, Vue and Svelte dev builds.
- The user can pick an element or send a page's errors to you; when they mention a pick
  ("pick 3", "the element I picked"), read it with get_picks.
- The user can watch and stop you at any time; a tab they stop sharing disappears from list_tabs.`

async function captureScreenshot(
  context: AgentContext,
  tab: Tab,
  fullPage: boolean
): Promise<{ image: NativeImage; note: string }> {
  const cdp = context.cdp(tab)
  if (fullPage) {
    const metrics = await cdp.send<{ cssContentSize: { width: number; height: number } }>(
      'Page.getLayoutMetrics'
    )
    const width = Math.ceil(metrics.cssContentSize.width)
    const fullHeight = Math.ceil(metrics.cssContentSize.height)
    const height = Math.min(fullHeight, MAX_FULL_PAGE_HEIGHT)
    const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 }
    })
    const note =
      height < fullHeight ? ` (cut at ${height} of ${fullHeight} CSS px: too tall to capture)` : ''
    return { image: nativeImage.createFromBuffer(Buffer.from(data, 'base64')), note }
  }
  // The view on screen draws its own frames; a tab in the background may not, so ask Chromium.
  // An emulated viewport is only part of the view: Chromium captures just that part.
  const image = context.debug(tab).emulation.viewport ? null : await tab.webContents.capturePage()
  if (image && !image.isEmpty()) return { image, note: '' }
  const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
  return { image: nativeImage.createFromBuffer(Buffer.from(data, 'base64')), note: '' }
}

const PAGE_TEXT = `(() => ({
  title: document.title,
  url: location.href,
  text: document.body ? document.body.innerText : ''
}))()`

interface RemoteObject {
  type: string
  subtype?: string
  objectId?: string
  value?: unknown
  unserializableValue?: string
  description?: string
}

interface ExceptionDetails {
  text: string
  lineNumber: number
  columnNumber: number
  exception?: RemoteObject
}

interface EvaluateResult {
  result: RemoteObject
  exceptionDetails?: ExceptionDetails
}

// Objects evaluate keeps alive in the page until its reply is sent.
const OBJECT_GROUP = 'browminal-agent'
// Shown by their description: as JSON they'd be {} or lose what matters.
const DESCRIBED_SUBTYPES = new Set(['node', 'error', 'regexp', 'date', 'proxy', 'promise'])

function throwIfException(details: ExceptionDetails | undefined): void {
  if (!details) return
  const where = `line ${details.lineNumber + 1}, column ${details.columnNumber + 1}`
  const message = details.exception?.description ?? details.text
  throw new Error(`${truncate(message, 4000)} (${where})`)
}

/**
 * Runs `expression` like the DevTools console and returns its result as text. In REPL mode a
 * returned promise isn't awaited for us, so it's awaited here; objects are then read as JSON.
 */
async function evaluateInPage(cdp: CdpSession, expression: string): Promise<string> {
  const evaluated = await cdp.send<EvaluateResult>('Runtime.evaluate', {
    expression,
    objectGroup: OBJECT_GROUP,
    awaitPromise: true,
    userGesture: true,
    replMode: true
  })
  throwIfException(evaluated.exceptionDetails)
  let result = evaluated.result
  if (result.subtype === 'promise' && result.objectId) {
    const awaited = await cdp.send<EvaluateResult>('Runtime.awaitPromise', {
      promiseObjectId: result.objectId
    })
    throwIfException(awaited.exceptionDetails)
    result = awaited.result
  }
  if (result.type === 'undefined') return 'undefined'
  if (result.type === 'function' || DESCRIBED_SUBTYPES.has(result.subtype ?? '')) {
    return result.description ?? result.type
  }
  if (!result.objectId) return formatValue(result.value ?? result.unserializableValue)
  try {
    const { result: json } = await cdp.send<EvaluateResult>('Runtime.callFunctionOn', {
      objectId: result.objectId,
      functionDeclaration: 'function () { return this }',
      returnByValue: true
    })
    return formatValue(json.value)
  } catch {
    // Not JSON (cycles, too deep): its description at least says what it is.
    return result.description ?? result.type
  }
}

/** One MCP server with every tool, for one request (the agent server is stateless). */
export function createAgentMcp(context: AgentContext, version: string): McpServer {
  const mcp = new McpServer({ name: 'browminal', version }, { instructions: INSTRUCTIONS })

  mcp.registerTool(
    'list_tabs',
    {
      description: 'Lists the tabs shared with agents: id, title and URL, and which one is active.',
      annotations: { readOnlyHint: true }
    },
    async () => text(describeTabs(context.listTabs()))
  )

  mcp.registerTool(
    'new_tab',
    {
      description:
        'Opens a URL in a new tab, shared with agents, and waits for it to load. ' +
        'Bare hosts work (localhost:5173, example.com).',
      inputSchema: {
        url: z.string().max(8192).describe('The address to open'),
        background: z
          .boolean()
          .optional()
          .describe('Open behind the current tab instead of in front (default false)')
      }
    },
    async ({ url, background }) => {
      const target = resolveInput(url)
      if (!isHttpUrl(target)) throw new Error('Only http(s) addresses can be opened')
      const tab = await context.openTab(target, background ?? false)
      return context.run(tab, async () => {
        // The page started loading in openTab; it may be done by now (run waits for the tab
        // to be on screen first).
        if (tab.webContents.isLoading()) await waitForLoad(tab.webContents)
        return text(describeLoad(tab))
      })
    }
  )

  mcp.registerTool(
    'select_tab',
    {
      description:
        'Brings a shared tab to the front; the next tools act on it when they name no tab.',
      inputSchema: { tabId: z.number().int() }
    },
    async ({ tabId }) => text(describeLoad(context.selectTab(tabId)))
  )

  mcp.registerTool(
    'close_tab',
    {
      description: 'Closes a tab this agent opened with new_tab. Tabs the user opened stay open.',
      inputSchema: { tabId: z.number().int() }
    },
    async ({ tabId }) => {
      context.closeTab(tabId)
      return text(`Closed tab ${tabId}.`)
    }
  )

  mcp.registerTool(
    'navigate',
    {
      description:
        'Loads a URL in a tab, or goes back, forward or reloads; waits for the page to load.',
      inputSchema: {
        tabId: tabIdInput,
        url: z.string().max(8192).optional().describe('The address to load'),
        action: z
          .enum(['back', 'forward', 'reload', 'hardReload'])
          .optional()
          .describe('Instead of url. hardReload skips the cache.')
      }
    },
    async ({ tabId, url, action }) => {
      if ((url === undefined) === (action === undefined)) {
        throw new Error('Give either url or action')
      }
      const tab = context.tab(tabId)
      return context.run(tab, async () => {
        if (url !== undefined) {
          const target = resolveInput(url)
          if (!isHttpUrl(target)) throw new Error('Only http(s) addresses can be loaded')
          const loaded = waitForLoad(tab.webContents)
          tab.load(target)
          await loaded
        } else {
          const history = tab.webContents.navigationHistory
          if (action === 'back' && !history.canGoBack()) throw new Error('Nothing to go back to')
          if (action === 'forward' && !history.canGoForward())
            throw new Error('Nothing to go forward to')
          const loaded = waitForLoad(tab.webContents)
          if (action === 'back') tab.back()
          else if (action === 'forward') tab.forward()
          else tab.reload(action === 'hardReload')
          await loaded
        }
        return text(describeLoad(tab))
      })
    }
  )

  mcp.registerTool(
    'screenshot',
    {
      description:
        'Takes a screenshot of a tab: what is visible, or the whole page. Scaled down to maxWidth.',
      inputSchema: {
        tabId: tabIdInput,
        fullPage: z.boolean().optional().describe('The whole scrollable page (default false)'),
        maxWidth: z
          .number()
          .int()
          .min(200)
          .max(3840)
          .optional()
          .describe(`Widest the image may be, in px (default ${DEFAULT_SCREENSHOT_WIDTH})`),
        format: z.enum(['jpeg', 'png']).optional().describe('Default jpeg (smaller)')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ tabId, fullPage, maxWidth, format }) => {
      const tab = context.tab(tabId)
      assertInspectable(tab)
      return context.run(tab, async () => {
        const { image, note } = await captureScreenshot(context, tab, fullPage ?? false)
        // An emulated phone is drawn at its pixel ratio: shown at its CSS size unless asked.
        const emulated = context.debug(tab).emulation.viewport?.width
        const defaultWidth = Math.min(DEFAULT_SCREENSHOT_WIDTH, emulated ?? Infinity)
        if (image.isEmpty()) throw new Error('The page has not drawn anything yet')
        const size = image.getSize()
        const target = scaledSize(size.width, size.height, maxWidth ?? defaultWidth)
        const scaled = target.width === size.width ? image : image.resize(target)
        const png = format === 'png'
        const data = png ? scaled.toPNG() : scaled.toJPEG(JPEG_QUALITY)
        return {
          content: [
            {
              type: 'image' as const,
              data: data.toString('base64'),
              mimeType: png ? 'image/png' : 'image/jpeg'
            },
            {
              type: 'text' as const,
              text: `${describeLoad(tab)}\n${target.width}×${target.height}${note}`
            }
          ]
        }
      })
    }
  )

  mcp.registerTool(
    'get_page_text',
    {
      description: "A page's title, URL and visible text (innerText).",
      inputSchema: {
        tabId: tabIdInput,
        maxChars: z
          .number()
          .int()
          .min(100)
          .max(MAX_AGENT_TEXT)
          .optional()
          .describe(`Cut the text here (default ${MAX_AGENT_TEXT})`)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ tabId, maxChars }) => {
      const tab = context.tab(tabId)
      assertInspectable(tab)
      return context.run(tab, async () => {
        // In an isolated world, so the page's own scripts can't change what's read.
        const page: unknown = await tab.webContents.executeJavaScriptInIsolatedWorld(
          AGENT_WORLD_ID,
          [{ code: PAGE_TEXT }]
        )
        const { title, url, text: body } = (page ?? {}) as Record<string, unknown>
        if (typeof title !== 'string' || typeof url !== 'string' || typeof body !== 'string') {
          throw new Error("Couldn't read the page")
        }
        return text(`# ${title}\n${url}\n\n${truncate(body, maxChars ?? MAX_AGENT_TEXT)}`)
      })
    }
  )

  mcp.registerTool(
    'evaluate',
    {
      description:
        'Runs JavaScript in the page, like the DevTools console, and returns the result as JSON. ' +
        'Top-level await works; promises are awaited. Has user activation (can click, focus, play). ' +
        'Runs in the page’s global scope: wrap code in { } or an IIFE to avoid clashing with the ' +
        'page’s own top-level const/let names.',
      inputSchema: {
        tabId: tabIdInput,
        expression: z.string().max(100_000).describe('The code; its last expression is returned')
      }
    },
    async ({ tabId, expression }) => {
      const tab = context.tab(tabId)
      assertInspectable(tab)
      return context.run(tab, async () => {
        const cdp = context.cdp(tab)
        try {
          return text(await evaluateInPage(cdp, expression))
        } finally {
          cdp.send('Runtime.releaseObjectGroup', { objectGroup: OBJECT_GROUP }).catch(() => {})
        }
      })
    }
  )

  registerPageTools(mcp, context)
  registerDebugTools(mcp, context)
  registerPickTools(mcp, context)
  return mcp
}
