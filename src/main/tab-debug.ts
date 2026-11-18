import { randomBytes } from 'node:crypto'
import type { Session, WebContents } from 'electron'
import { isHttpUrl } from '../shared/url'
import { canInspect } from './agent-policy'
import { CdpSession, type RawSend } from './cdp'
import {
  ConsoleLog,
  type ConsoleEntry,
  fromConsoleApiCalled,
  fromExceptionThrown,
  fromLogEntry,
  navigationEntry
} from './console-log'
import {
  applyEmulationChange,
  emulationLabel,
  NETWORKS,
  NO_EMULATION,
  type Emulation,
  type EmulationChange
} from './emulation'
import { NetworkLog } from './network-log'
import { MAX_SOURCE_MAP_BYTES, SourceMaps } from './source-maps'
import { themeColors } from './theme'
import {
  abortExpression,
  callExpression,
  parsePageMessage,
  webMcpShim,
  type PageTool,
  type PageToolResult
} from './webmcp'

/** How long a page tool may take: UI SDK's `allow` waits up to 5 minutes for the person. */
export const PAGE_TOOL_TIMEOUT_MS = 330_000

interface PageToolCall {
  resolve: (result: PageToolResult) => void
  reject: (error: Error) => void
}

// What Chromium keeps of response bodies for network_request.
const MAX_TOTAL_BODIES = 20 * 1024 * 1024
const MAX_BODY = 5 * 1024 * 1024

const SOURCE_MAP_TIMEOUT_MS = 15_000

const NO_NETWORK_THROTTLING = {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1
}

/** Called when picking ends: with the element the user clicked, or null when it was cancelled. */
export type PickEnd = (backendNodeId: number | null) => void

// How long a page kept awake (wakeIfHidden) gets to notice, how often it's asked, and how long
// one answer may take.
const AWAKE_TIMEOUT_MS = 1500
const AWAKE_POLL_MS = 40
const AWAKE_PROBE_TIMEOUT_MS = 2000

/**
 * The debugger on one shared tab and what's recorded through it: the console and network logs
 * and the scripts' source maps (from the moment it's attached, which is when the tab is shared
 * or an agent first uses it), what an agent emulates there, and picking an element for an
 * agent. Nothing is recorded while the tab shows a browminal:// page. Detaching the debugger ends
 * all of it, emulation included.
 */
export class TabDebug {
  readonly cdp: CdpSession
  readonly console = new ConsoleLog()
  readonly network = new NetworkLog()
  readonly sourceMaps: SourceMaps
  private emulationState: Emulation = NO_EMULATION
  /** The last error the user sent or dismissed, or an agent read: the badge counts newer ones. */
  private errorsSeenSeq = 0
  private pickState: { stop: () => void; end: PickEnd } | null = null
  // Whether the page is told it's visible and focused although its window isn't (see wakeIfHidden).
  private awake = false
  /** The CDP binding the page's WebMCP shim reports through (a fresh name per share). */
  private readonly webMcpBinding = `__browminal_${randomBytes(8).toString('hex')}`
  private pageToolList: readonly PageTool[] = []
  private readonly pageToolCalls = new Map<number, PageToolCall>()
  private nextPageToolCall = 1

  constructor(
    private readonly webContents: WebContents,
    /** Called when the emulation label or the count of new errors changes. */
    private readonly onChange: () => void
  ) {
    this.cdp = new CdpSession(webContents)
    this.sourceMaps = new SourceMaps((url) => fetchText(webContents.session, url))
    const { cdp } = this
    const recording = (handler: (params: Record<string, unknown>) => void) => {
      return (params: Record<string, unknown>): void => {
        if (canInspect(this.webContents.getURL())) handler(params)
      }
    }
    cdp.on(
      'Runtime.consoleAPICalled',
      recording((params) => {
        const entry = fromConsoleApiCalled(params)
        if (!entry) return
        this.console.add(entry)
        if (entry.level === 'error') this.onChange()
      })
    )
    cdp.on(
      'Runtime.exceptionThrown',
      recording((params) => {
        this.console.add(fromExceptionThrown(params))
        this.onChange()
      })
    )
    cdp.on(
      'Log.entryAdded',
      recording((params) => this.console.add(fromLogEntry(params)))
    )
    // The Debugger domain is on only for source maps, and the page's `debugger;` statements
    // must never pause it: nobody is there to resume. Chromium forgets setSkipAllPauses when
    // the tab moves to a new renderer process (a cross-site navigation) while the domain stays
    // on, so skip again on each new page, and resume a pause that slips in before that.
    const skipPauses = (): void => {
      cdp.send('Debugger.setSkipAllPauses', { skip: true }).catch(() => {})
    }
    cdp.on('Debugger.paused', () => {
      skipPauses()
      cdp.send('Debugger.resume').catch(() => {})
    })
    // These two look at the URL being loaded: the tab still shows the page it's leaving.
    cdp.on('Page.frameNavigated', ({ frame }) => {
      const { parentId, url } = (frame ?? {}) as { parentId?: string; url?: string }
      if (parentId) return
      skipPauses()
      if (this.awake) this.sendAwake((method, params) => cdp.send(method, params)).catch(() => {})
      if (url && canInspect(url)) this.console.add(navigationEntry(url))
      // A new page: what was being picked on the old one is gone, and so are its errors and
      // its tools (the new one registers its own).
      this.endPicking(null)
      this.pageToolList = []
      this.endPageToolCalls('The page loaded a new document before the tool answered')
      this.onChange()
    })
    cdp.on('Runtime.bindingCalled', ({ name, payload }) => {
      if (name !== this.webMcpBinding || typeof payload !== 'string') return
      if (!canInspect(this.webContents.getURL())) return
      const message = parsePageMessage(payload)
      if (!message) return
      if (message.type === 'tools') {
        this.pageToolList = message.tools
        return
      }
      const call = this.pageToolCalls.get(message.id)
      if (!call) return
      this.pageToolCalls.delete(message.id)
      call.resolve(message)
    })
    cdp.on('Debugger.scriptParsed', ({ url, sourceMapURL }) => {
      if (typeof url === 'string' && typeof sourceMapURL === 'string')
        this.sourceMaps.register(url, sourceMapURL)
    })
    cdp.on('Network.requestWillBeSent', (params) => {
      const { url } = (params.request ?? {}) as { url?: string }
      const isPageLoad = params.type === 'Document' && params.loaderId === params.requestId
      if (canInspect(this.webContents.getURL()) || (isPageLoad && isHttpUrl(String(url))))
        this.network.requestWillBeSent(params)
    })
    cdp.on('Network.responseReceived', (params) => this.network.responseReceived(params))
    cdp.on('Network.loadingFinished', (params) => this.network.loadingFinished(params))
    cdp.on('Network.loadingFailed', (params) => this.network.loadingFailed(params))
    cdp.onAttach(async (send) => {
      await send('Runtime.enable')
      await send('Log.enable')
      await send('Network.enable', {
        maxTotalBufferSize: MAX_TOTAL_BODIES,
        maxResourceBufferSize: MAX_BODY
      })
      // For each script's source map (scriptParsed); never pausing (see skipPauses).
      await send('Debugger.enable')
      await send('Debugger.setSkipAllPauses', { skip: true })
      // WebMCP: the page's own tools (document.modelContext), in the page loaded now and in
      // every page after it. The binding comes first: the shim takes it as it runs.
      await send('Runtime.addBinding', { name: this.webMcpBinding })
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: webMcpShim(this.webMcpBinding),
        runImmediately: true
      })
      // Attached again after something else detached the debugger: put the emulation back.
      if (emulationLabel(this.emulationState)) await this.applyEmulation(send)
      if (this.awake) await this.sendAwake(send)
    })
  }

  /** Attaches the debugger now, so the logs start. */
  start(): void {
    this.cdp.attach().catch(() => {
      // DevTools has the tab, or it closed; the first tool says so.
    })
  }

  get emulation(): Emulation {
    return this.emulationState
  }

  /** The address bar badge: what's emulated, or null. */
  get emulationLabel(): string | null {
    return emulationLabel(this.emulationState)
  }

  async emulate(change: EmulationChange | 'reset'): Promise<void> {
    const before = this.emulationLabel
    this.emulationState =
      change === 'reset' ? NO_EMULATION : applyEmulationChange(this.emulationState, change)
    try {
      await this.applyEmulation((method, params) => this.cdp.send(method, params))
    } finally {
      if (this.emulationLabel !== before) this.onChange()
    }
  }

  /** The page's errors since it loaded that nobody has sent, dismissed or read yet. */
  get newErrors(): ConsoleEntry[] {
    return this.console.errorsAfter(Math.max(this.errorsSeenSeq, this.console.pageSeq))
  }

  /** The errors so far were sent, dismissed or read: the badge starts again from 0. */
  markErrorsSeen(): void {
    if (this.errorsSeenSeq === this.console.lastSeq) return
    this.errorsSeenSeq = this.console.lastSeq
    this.onChange()
  }

  /** The tools the page registered with WebMCP (document.modelContext), as it last said. */
  get pageTools(): readonly PageTool[] {
    return this.pageToolList
  }

  /**
   * Runs one of the page's WebMCP tools and resolves with what it returned (or threw). The call
   * is started by one evaluate and answered through the binding, so a tool may ask the person
   * (a confirm(), UI SDK's `allow`) for as long as `timeoutMs`; after that it's told to stop.
   */
  async callPageTool(
    name: string,
    input: Record<string, unknown>,
    timeoutMs = PAGE_TOOL_TIMEOUT_MS
  ): Promise<PageToolResult> {
    const id = this.nextPageToolCall++
    const answered = new Promise<PageToolResult>((resolve, reject) => {
      this.pageToolCalls.set(id, { resolve, reject })
    })
    // It may be rejected (the page navigated) before it's awaited below.
    answered.catch(() => {})
    let timer: NodeJS.Timeout | undefined
    try {
      const { result } = await this.cdp.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
        expression: callExpression(id, name, input),
        returnByValue: true,
        userGesture: true
      })
      if (result?.value !== true) {
        throw new Error(
          result?.value === false
            ? `The page has no tool named "${name}" (page_tools lists them)`
            : 'This page offers no tools of its own (WebMCP)'
        )
      }
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          this.cdp.send('Runtime.evaluate', { expression: abortExpression(id) }).catch(() => {})
          reject(new Error(`The page's tool "${name}" didn't answer in ${timeoutMs / 1000}s`))
        }, timeoutMs)
      })
      return await Promise.race([answered, timeout])
    } finally {
      clearTimeout(timer)
      this.pageToolCalls.delete(id)
    }
  }

  private endPageToolCalls(reason: string): void {
    for (const call of this.pageToolCalls.values()) call.reject(new Error(reason))
    this.pageToolCalls.clear()
  }

  /** Whether the user is picking an element on this tab. */
  get picking(): boolean {
    return this.pickState !== null
  }

  /**
   * Lets the user pick an element: the page shows DevTools' inspect highlight, and the next
   * click picks the element under it instead of reaching the page. `end` is called once, with
   * the element or null (cancelled, the page navigated, the tab stopped being shared).
   */
  async startPicking(end: PickEnd): Promise<void> {
    this.endPicking(null)
    const { cdp } = this
    const [r, g, b] = hexRgb(themeColors().accent)
    await cdp.send('DOM.enable')
    await cdp.send('Overlay.enable')
    await cdp.send('Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: {
        showInfo: true,
        contentColor: { r, g, b, a: 0.28 },
        paddingColor: { r, g, b, a: 0.14 },
        marginColor: { r, g, b, a: 0.08 },
        borderColor: { r, g, b, a: 0.9 }
      }
    })
    const offPicked = cdp.on('Overlay.inspectNodeRequested', ({ backendNodeId }) => {
      this.endPicking(typeof backendNodeId === 'number' ? backendNodeId : null)
    })
    const offCancelled = cdp.on('Overlay.inspectModeCanceled', () => this.endPicking(null))
    this.pickState = {
      end,
      stop: () => {
        offPicked()
        offCancelled()
        const quiet = (method: string, params?: Record<string, unknown>): void => {
          cdp.send(method, params).catch(() => {})
        }
        quiet('Overlay.setInspectMode', { mode: 'none' })
        quiet('Overlay.hideHighlight')
        quiet('Overlay.disable')
        quiet('DOM.disable')
      }
    }
  }

  /** Stops picking, if it's on; its `end` hears `backendNodeId` (null: nothing was picked). */
  endPicking(backendNodeId: number | null = null): void {
    const picking = this.pickState
    if (!picking) return
    this.pickState = null
    if (!this.webContents.isDestroyed()) picking.stop()
    picking.end(backendNodeId)
  }

  /**
   * Chromium treats the pages of a window that is minimized, hidden or covered by other windows
   * as hidden: they stop drawing and drop mouse presses, so an agent's click was lost though the
   * tool said it clicked. Before an agent's tool runs, a page that says it's hidden is told it's
   * visible and focused, until the window is back in front (`sleep`).
   *
   * The page's word is only used to decide this and to wait for it: if it lies, the page is kept
   * awake for nothing, or the short wait runs out.
   */
  async wakeIfHidden(): Promise<void> {
    try {
      if ((await this.visibility()) !== 'hidden') return
      this.awake = true
      await this.sendAwake((method, params) => this.cdp.send(method, params))
      // The page hears about it a moment later; until then it still drops presses.
      const end = Date.now() + AWAKE_TIMEOUT_MS
      while (Date.now() < end && (await this.visibility()) === 'hidden') {
        await new Promise((resolve) => setTimeout(resolve, AWAKE_POLL_MS))
      }
    } catch {
      // A dialog is open, the page is busy or the debugger is gone: the tool that follows says so.
    }
  }

  /** The window is in front again: the page hears about its real visibility and focus. */
  sleep(): void {
    if (!this.awake) return
    this.awake = false
    this.sendAwake((method, params) => this.cdp.send(method, params)).catch(() => {})
  }

  private async visibility(): Promise<unknown> {
    const { result } = (await this.cdp.send(
      'Runtime.evaluate',
      { expression: 'document.visibilityState', returnByValue: true },
      AWAKE_PROBE_TIMEOUT_MS
    )) as { result?: { value?: unknown } }
    return result?.value
  }

  private async sendAwake(send: RawSend): Promise<void> {
    await send('Emulation.setFocusEmulationEnabled', { enabled: this.awake })
  }

  /** Turns emulation and picking off and detaches. */
  dispose(): void {
    this.endPicking(null)
    this.awake = false
    this.pageToolList = []
    this.endPageToolCalls('The tab stopped being shared')
    if (this.emulationLabel === null) {
      this.cdp.detach()
      return
    }
    // Detaching alone leaves the emulated viewport size behind: clear it first.
    this.emulationState = NO_EMULATION
    this.onChange()
    this.applyEmulation((method, params) => this.cdp.send(method, params))
      .catch(() => {})
      .finally(() => this.cdp.detach())
  }

  /** Sends every part of the emulation, on or off (each call is idempotent). */
  private async applyEmulation(send: RawSend): Promise<void> {
    const { viewport, userAgent, colorScheme, network, cpu } = this.emulationState
    if (viewport) {
      await send('Emulation.setDeviceMetricsOverride', { ...viewport })
    } else {
      await send('Emulation.clearDeviceMetricsOverride')
    }
    await send('Emulation.setTouchEmulationEnabled', {
      enabled: viewport?.mobile ?? false,
      maxTouchPoints: 5
    })
    // An empty override puts the tab's own user agent back.
    await send('Emulation.setUserAgentOverride', { userAgent: userAgent ?? '' })
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: colorScheme ?? '' }]
    })
    if (network) {
      const { offline, latency, downloadThroughput, uploadThroughput } = NETWORKS[network]
      await send('Network.emulateNetworkConditions', {
        offline,
        latency,
        downloadThroughput,
        uploadThroughput
      })
    } else {
      await send('Network.emulateNetworkConditions', NO_NETWORK_THROTTLING)
    }
    await send('Emulation.setCPUThrottlingRate', { rate: cpu ?? 1 })
  }
}

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** A source map's text through the tab's own session (its cookies, its proxy), size-capped. */
async function fetchText(session: Session, url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SOURCE_MAP_TIMEOUT_MS)
  try {
    const response = await session.fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > MAX_SOURCE_MAP_BYTES) {
      throw new Error('Too big')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_SOURCE_MAP_BYTES) {
        reader.cancel().catch(() => {})
        throw new Error('Too big')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    clearTimeout(timer)
  }
}
