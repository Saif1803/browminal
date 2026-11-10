import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { truncate } from './agent-policy'
import { callOn, DESCRIBE_ELEMENT } from './agent-page-tools'
import {
  assertInspectable,
  describeLoad,
  tabIdInput,
  text,
  type AgentContext
} from './agent-tool-helpers'
import { elementSource } from './agent-picks'
import { formatConsoleEntries, type ConsoleLevel } from './console-log'
import {
  formatBoxModel,
  formatComputed,
  formatMatchedStyles,
  rulePlaces,
  type BoxModel,
  type MatchedStyles,
  type SheetInfo
} from './element-inspect'
import { formatOriginal, mapRefFor, type MapRef, type OriginalPosition } from './source-maps'
import { DEVICE_NAMES, emulationLabel, NETWORKS, type NetworkName } from './emulation'
import { formatBytes, formatNetworkDetail, formatNetworkLine } from './network-log'
import type { Tab } from './tabs'
import type { CdpSession } from './cdp'

const DEFAULT_BODY_CHARS = 20_000
const DEFAULT_HTML_CHARS = 2000
const MAX_LIST = 500
// Bodies of these types are text even when Chromium hands them over base64-encoded.
const TEXT_MIME =
  /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded)|image\/svg)|\+json|\+xml/

const refInput = z.number().int().positive().describe('The element’s ref, from read_page or find')
const limitInput = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIST)
  .optional()
  .describe('The newest this many (default 50)')

const RECORDING_NOTE =
  'Recorded since the tab was shared with agents (or an agent first used it), across reloads.'

/** The console, network, element and emulation tools: DevTools for the agent. */
export function registerDebugTools(mcp: McpServer, context: AgentContext): void {
  const page = (tabId: number | undefined): { tab: Tab; cdp: CdpSession } => {
    const tab = context.tab(tabId)
    assertInspectable(tab)
    return { tab, cdp: context.cdp(tab) }
  }

  mcp.registerTool(
    'console_messages',
    {
      description:
        'The tab’s console: console.* calls, uncaught exceptions with stack traces, and the ' +
        'browser’s own messages (failed loads, CSP, deprecations). Newest last; each has a #seq: ' +
        'pass the last one as since to see only what came after. ' +
        RECORDING_NOTE,
      inputSchema: {
        tabId: tabIdInput,
        level: z
          .enum(['error', 'warning', 'info', 'debug'])
          .optional()
          .describe('The least severe level to show (default debug: everything)'),
        since: z.number().int().min(0).optional().describe('Only messages after this #seq'),
        pattern: z
          .string()
          .max(500)
          .optional()
          .describe('Only messages whose text or source URL contains this (case-insensitive)'),
        limit: limitInput,
        clear: z.boolean().optional().describe('Empty the log after reading it')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ tabId, level, since, pattern, limit, clear }) => {
      const { tab } = page(tabId)
      return context.run(tab, async () => {
        const debug = context.debug(tab)
        const log = debug.console
        const { entries, matched } = log.query({
          level: level as ConsoleLevel | undefined,
          since,
          pattern,
          limit
        })
        // The agent has seen the page's errors now: the user's errors badge starts again.
        if (entries.some((entry) => entry.level === 'error')) debug.markErrorsSeen()
        if (clear) log.clear()
        const head = `${describeLoad(tab)}\n${RECORDING_NOTE}`
        if (entries.length === 0) {
          return text(`${head}\nNo console messages${since ? ` after #${since}` : ''}.`)
        }
        const shown = matched > entries.length ? `The newest ${entries.length} of ${matched}:` : ''
        const body = await formatConsoleEntries(entries, debug.sourceMaps)
        const next = `(newest #${log.lastSeq}${clear ? '; log cleared' : ''})`
        return text(truncate([head, shown, body, next].filter(Boolean).join('\n')))
      })
    }
  )

  mcp.registerTool(
    'network_requests',
    {
      description:
        'The tab’s network requests: method, status (or why it failed), type, URL, size, time. ' +
        'Newest last; network_request(id) shows one in full with its response body. ' +
        RECORDING_NOTE,
      inputSchema: {
        tabId: tabIdInput,
        pattern: z.string().max(500).optional().describe('Only URLs containing this'),
        type: z
          .string()
          .max(40)
          .optional()
          .describe(
            'Only this type: Document, Script, Stylesheet, Fetch, XHR, Image, Font… or api (Fetch and XHR)'
          ),
        method: z.string().max(20).optional().describe('Only this method (GET, POST…)'),
        failed: z
          .boolean()
          .optional()
          .describe('Only failed requests and HTTP errors (status 400 and up)'),
        since: z.number().int().min(0).optional().describe('Only requests after this #id'),
        limit: limitInput
      },
      annotations: { readOnlyHint: true }
    },
    async ({ tabId, ...query }) => {
      const { tab } = page(tabId)
      return context.run(tab, async () => {
        const log = context.debug(tab).network
        const { entries, matched } = log.query(query)
        const head = `${describeLoad(tab)}\n${RECORDING_NOTE}`
        if (entries.length === 0) return text(`${head}\nNo requests match.`)
        const shown = matched > entries.length ? `The newest ${entries.length} of ${matched}:` : ''
        const pending = log.pending()
        const tail = `(newest #${log.lastId}${pending ? `; ${pending} still open` : ''})`
        return text(
          truncate(
            [head, shown, entries.map(formatNetworkLine).join('\n'), tail]
              .filter(Boolean)
              .join('\n')
          )
        )
      })
    }
  )

  mcp.registerTool(
    'network_request',
    {
      description:
        'One request in full: status, headers (credentials and cookies shown as REDACTED), ' +
        'request body and response body.',
      inputSchema: {
        tabId: tabIdInput,
        id: z.number().int().positive().describe('The #id from network_requests'),
        body: z.boolean().optional().describe('Include the response body (default true)'),
        maxChars: z
          .number()
          .int()
          .min(100)
          .max(100_000)
          .optional()
          .describe(`Cut the body here (default ${DEFAULT_BODY_CHARS})`)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ tabId, id, body, maxChars }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const log = context.debug(tab).network
        const entry = log.get(id)
        if (!entry) {
          throw new Error(
            `No request #${id} in the log (it keeps the newest 500). Call network_requests.`
          )
        }
        const detail = formatNetworkDetail(entry)
        if (body === false) return text(detail)
        let response: string
        if (entry.redirectedTo) response = '(a redirect: no body)'
        else if (entry.state === 'pending') response = '(still loading)'
        else if (entry.state === 'failed') response = '(failed: no body)'
        else if (!log.isLatestHop(entry)) response = '(no longer kept)'
        else {
          try {
            const result = await cdp.send<{ body: string; base64Encoded: boolean }>(
              'Network.getResponseBody',
              { requestId: entry.requestId }
            )
            if (!result.base64Encoded) {
              response = truncate(result.body, maxChars ?? DEFAULT_BODY_CHARS)
            } else if (TEXT_MIME.test(entry.mimeType)) {
              const decoded = Buffer.from(result.body, 'base64').toString('utf8')
              response = truncate(decoded, maxChars ?? DEFAULT_BODY_CHARS)
            } else {
              const bytes = Math.floor((result.body.length * 3) / 4)
              response = `(binary ${entry.mimeType || 'data'}, ${formatBytes(bytes)}: not shown)`
            }
            if (response === '') response = '(empty)'
          } catch (error) {
            if (cdp.dialog) throw error
            response = '(Chromium no longer has the body: the page moved on or it was too big)'
          }
        }
        return text(`${detail}\nResponse body:\n${response}`)
      })
    }
  )

  mcp.registerTool(
    'inspect',
    {
      description:
        'An element in depth: its HTML, box (size, position, padding, border, margin), computed ' +
        'styles, and the CSS rules that match it with the stylesheet URL and line of each, ' +
        'overridden declarations marked. Use it to find why something looks wrong and where to fix it.',
      inputSchema: {
        tabId: tabIdInput,
        ref: refInput,
        properties: z
          .array(z.string().max(80))
          .max(100)
          .optional()
          .describe('The computed styles to show (default: layout, box, colour and font ones)'),
        maxHtml: z
          .number()
          .int()
          .min(100)
          .max(50_000)
          .optional()
          .describe(`Cut the outer HTML here (default ${DEFAULT_HTML_CHARS})`)
      },
      annotations: { readOnlyHint: true }
    },
    async ({ tabId, ref, properties, maxHtml }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        let outerHTML: string
        try {
          ;({ outerHTML } = await cdp.send<{ outerHTML: string }>('DOM.getOuterHTML', {
            backendNodeId: ref
          }))
        } catch (error) {
          if (cdp.dialog) throw error
          throw new Error(
            `No element with ref=${ref} on the page now (it changed?). Call read_page again.`
          )
        }
        const parts = [truncate(outerHTML, maxHtml ?? DEFAULT_HTML_CHARS)]
        const debug = context.debug(tab)
        const source = await elementSource(cdp, debug, ref)
        if (source) parts.push(`source: ${source}`)
        try {
          const { model } = await cdp.send<{ model: BoxModel }>('DOM.getBoxModel', {
            backendNodeId: ref
          })
          parts.push(formatBoxModel(model))
        } catch {
          parts.push('box: not rendered (display: none, or not in the page)')
        }

        // The CSS domain reports every stylesheet as it's enabled: that's where rules point to.
        const sheets = new Map<string, SheetInfo>()
        // Each sheet's source map, and the <style> element of the sheets that have no URL.
        const sheetMaps = new Map<string, MapRef>()
        const owners = new Map<string, number>()
        const documentUrl = tab.webContents.getURL()
        const offSheets = cdp.on('CSS.styleSheetAdded', ({ header }) => {
          const h = (header ?? {}) as Record<string, unknown>
          const id = String(h.styleSheetId)
          const sourceURL = String(h.sourceURL ?? '')
          sheets.set(id, {
            sourceURL,
            startLine: Number(h.startLine ?? 0),
            isInline: Boolean(h.isInline),
            isConstructed: Boolean(h.isConstructed)
          })
          const map = mapRefFor(sourceURL || documentUrl, String(h.sourceMapURL ?? ''))
          if (map) sheetMaps.set(id, map)
          if (!sourceURL && typeof h.ownerNode === 'number') owners.set(id, h.ownerNode)
        })
        try {
          await cdp.send('DOM.enable')
          await cdp.send('CSS.enable')
          await cdp.send('DOM.getDocument', { depth: 0 })
          const { nodeIds } = await cdp.send<{ nodeIds: number[] }>(
            'DOM.pushNodesByBackendIdsToFrontend',
            { backendNodeIds: [ref] }
          )
          const nodeId = nodeIds[0]
          const { computedStyle } = await cdp.send<{
            computedStyle: { name: string; value: string }[]
          }>('CSS.getComputedStyleForNode', { nodeId })
          parts.push(`Computed:\n${formatComputed(computedStyle, properties)}`)
          const matched = await cdp.send<MatchedStyles>('CSS.getMatchedStylesForNode', { nodeId })
          const places = rulePlaces(matched)
          await Promise.all(
            [...new Set(places.map((place) => place.styleSheetId))].map(async (id) => {
              const sheet = sheets.get(id)
              const owner = owners.get(id)
              if (sheet && owner !== undefined && !sheetMaps.has(id))
                sheet.file = (await viteFileOf(cdp, owner)) ?? undefined
            })
          )
          const originals = new Map<string, OriginalPosition>()
          await Promise.all(
            places.map(async (place) => {
              const map = sheetMaps.get(place.styleSheetId)
              const original =
                map && (await debug.sourceMaps.original(map, place.line, place.column))
              if (original)
                originals.set(`${place.styleSheetId}:${place.line}:${place.column}`, original)
            })
          )
          const rules = formatMatchedStyles(matched, sheets, documentUrl, (place) => {
            const original = originals.get(`${place.styleSheetId}:${place.line}:${place.column}`)
            return original ? formatOriginal(original) : null
          })
          parts.push(`Matching CSS rules, most specific first:\n${rules}`)
        } catch (error) {
          if (cdp.dialog) throw error
          parts.push(`(No styles: ${(error as Error).message}. Is ref=${ref} a text node?)`)
        } finally {
          offSheets()
          cdp.send('CSS.disable').catch(() => {})
          // Picking needs the DOM domain on (the inspect highlight).
          if (!debug.picking) cdp.send('DOM.disable').catch(() => {})
        }
        return text(parts.join('\n'))
      })
    }
  )

  mcp.registerTool(
    'set_style',
    {
      description:
        'Sets (or with an empty value removes) one CSS property in an element’s inline style, ' +
        'to try a fix live. Lost on reload: make the real change in the source.',
      inputSchema: {
        tabId: tabIdInput,
        ref: refInput,
        property: z.string().min(1).max(100).describe('e.g. "padding-top" or "--accent"'),
        value: z.string().max(2000).describe('e.g. "12px"; empty removes it'),
        important: z.boolean().optional()
      }
    },
    async ({ tabId, ref, property, value, important }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const result = await callOn<string | null>(
          cdp,
          ref,
          `function (name, value, priority) {
            if (!(this instanceof Element)) throw new Error('ref=' + ${ref} + ' is not an element')
            if (value === '') this.style.removeProperty(name)
            else if (!CSS.supports(name, value)) return null
            else this.style.setProperty(name, value, priority)
            return this.style.getPropertyValue(name)
          }`,
          [property, value, important ? 'important' : '']
        )
        const what = await callOn<string>(cdp, ref, DESCRIBE_ELEMENT).catch(() => 'element')
        if (result === null) {
          throw new Error(`${property}: ${value} isn’t valid CSS here (CSS.supports says no)`)
        }
        const did = value === '' ? `Removed ${property} from` : `Set ${property}: ${result} on`
        return text(`${did} ${what} [ref=${ref}] (inline style; lost on reload).`)
      })
    }
  )

  mcp.registerTool(
    'set_attribute',
    {
      description:
        'Sets (or with no value removes) an attribute on an element, to try a change live. ' +
        'Lost on reload.',
      inputSchema: {
        tabId: tabIdInput,
        ref: refInput,
        name: z
          .string()
          .regex(/^[^\s"'>/=]+$/, 'Not an attribute name')
          .max(100),
        value: z.string().max(10_000).optional().describe('Leave out to remove the attribute')
      }
    },
    async ({ tabId, ref, name, value }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        await callOn(
          cdp,
          ref,
          `function (name, value) {
            if (!(this instanceof Element)) throw new Error('ref=' + ${ref} + ' is not an element')
            if (value === null) this.removeAttribute(name)
            else this.setAttribute(name, value)
          }`,
          [name, value ?? null]
        )
        const what = await callOn<string>(cdp, ref, DESCRIBE_ELEMENT).catch(() => 'element')
        const did = value === undefined ? `Removed ${name} from` : `Set ${name}="${value}" on`
        return text(`${did} ${what} [ref=${ref}] (lost on reload).`)
      })
    }
  )

  mcp.registerTool(
    'emulate',
    {
      description:
        'Makes the tab act like another device or setting: a phone or tablet (size, pixel ' +
        'ratio, touch, user agent), any viewport, dark or light colour scheme, offline or a slow ' +
        'network. Changes add up; "none" turns one part off, reset turns all off. The user sees a ' +
        'badge in the address bar while any is on. Call with nothing to see what is on.',
      inputSchema: {
        tabId: tabIdInput,
        device: z.enum([...DEVICE_NAMES, 'none']).optional(),
        viewport: z
          .object({
            width: z.number().int().min(100).max(4000),
            height: z.number().int().min(100).max(4000),
            deviceScaleFactor: z.number().min(0.5).max(4).optional(),
            mobile: z.boolean().optional().describe('Mobile viewport and touch (default false)')
          })
          .optional()
          .describe('A custom size in CSS px, instead of a device'),
        colorScheme: z.enum(['light', 'dark', 'none']).optional().describe('prefers-color-scheme'),
        network: z
          .enum([...(Object.keys(NETWORKS) as [NetworkName, ...NetworkName[]]), 'none'])
          .optional(),
        reset: z.boolean().optional().describe('Turn everything off')
      }
    },
    async ({ tabId, reset, ...change }) => {
      const { tab } = page(tabId)
      return context.run(tab, async () => {
        const debug = context.debug(tab)
        const before = debug.emulation
        if (reset) await debug.emulate('reset')
        else if (Object.values(change).some((v) => v !== undefined)) await debug.emulate(change)
        const label = emulationLabel(debug.emulation)
        if (!label) return text(`${describeLoad(tab)}\nNothing is emulated.`)
        const notes = [`${describeLoad(tab)}\nEmulating: ${label}.`]
        if (debug.emulation.userAgent !== before.userAgent) {
          notes.push(
            'The user agent changes from the next request: reload for the server to see it.'
          )
        }
        notes.push('Ends when the tab stops being shared, or the user resets it from the badge.')
        return text(notes.join('\n'))
      })
    }
  )

  mcp.registerTool(
    'clear_site_data',
    {
      description:
        'Clears the cookies, storage (local, session, IndexedDB), cache storage and service ' +
        'workers of the tab’s site, after the user agrees in a dialog. Other sites keep theirs.',
      inputSchema: { tabId: tabIdInput }
    },
    async ({ tabId }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const origin = new URL(tab.webContents.getURL()).origin
        if (origin === 'null') throw new Error('This page has no site to clear')
        const agreed = await context.confirm({
          message: `An agent wants to clear the data of ${new URL(origin).host}`,
          detail:
            'Its cookies, storage, cache and service workers are deleted, so you’ll be signed ' +
            'out of it. Other sites keep theirs.',
          action: 'Clear site data',
          destructive: true
        })
        if (!agreed) return text(`The user said no: nothing was cleared on ${origin}.`)
        await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
        return text(
          `Cleared the data of ${origin}. The page still has what it loaded: reload to start fresh.`
        )
      })
    }
  )
}

/** Vite in dev injects each CSS file as <style data-vite-dev-id="<its path>">: that path. */
async function viteFileOf(cdp: CdpSession, backendNodeId: number): Promise<string | null> {
  try {
    const { node } = await cdp.send<{ node: { attributes?: string[] } }>('DOM.describeNode', {
      backendNodeId
    })
    const attributes = node.attributes ?? []
    const index = attributes.findIndex((name, i) => i % 2 === 0 && name === 'data-vite-dev-id')
    const file = index >= 0 ? attributes[index + 1] : ''
    return file ? file.replace(/\\/g, '/').slice(0, 1000) : null
  } catch {
    return null
  }
}
