import type { WebContents } from 'electron'
import { isHttpUrl } from '../shared/url'
import { canInspect } from './agent-policy'
import { CdpSession, type RawSend } from './cdp'
import {
  ConsoleLog,
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

// What Chromium keeps of response bodies for network_request.
const MAX_TOTAL_BODIES = 20 * 1024 * 1024
const MAX_BODY = 5 * 1024 * 1024

const NO_NETWORK_THROTTLING = {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1
}

/**
 * The debugger on one shared tab and what's recorded through it: the console and network logs
 * (from the moment it's attached, which is when the tab is shared or an agent first uses it)
 * and what an agent emulates there. Nothing is recorded while the tab shows a nebula:// page.
 * Detaching the debugger ends all of it, emulation included.
 */
export class TabDebug {
  readonly cdp: CdpSession
  readonly console = new ConsoleLog()
  readonly network = new NetworkLog()
  private emulationState: Emulation = NO_EMULATION

  constructor(
    private readonly webContents: WebContents,
    /** Called when the emulation label changes. */
    private readonly onEmulationChange: () => void
  ) {
    this.cdp = new CdpSession(webContents)
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
        if (entry) this.console.add(entry)
      })
    )
    cdp.on(
      'Runtime.exceptionThrown',
      recording((params) => this.console.add(fromExceptionThrown(params)))
    )
    cdp.on(
      'Log.entryAdded',
      recording((params) => this.console.add(fromLogEntry(params)))
    )
    // These two look at the URL being loaded: the tab still shows the page it's leaving.
    cdp.on('Page.frameNavigated', ({ frame }) => {
      const { parentId, url } = (frame ?? {}) as { parentId?: string; url?: string }
      if (!parentId && url && canInspect(url)) this.console.add(navigationEntry(url))
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
      // Attached again after something else detached the debugger: put the emulation back.
      if (emulationLabel(this.emulationState)) await this.applyEmulation(send)
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
      if (this.emulationLabel !== before) this.onEmulationChange()
    }
  }

  /** Turns emulation off and detaches. */
  dispose(): void {
    if (this.emulationLabel === null) {
      this.cdp.detach()
      return
    }
    // Detaching alone leaves the emulated viewport size behind: clear it first.
    this.emulationState = NO_EMULATION
    this.onEmulationChange()
    this.applyEmulation((method, params) => this.cdp.send(method, params))
      .catch(() => {})
      .finally(() => this.cdp.detach())
  }

  /** Sends every part of the emulation, on or off (each call is idempotent). */
  private async applyEmulation(send: RawSend): Promise<void> {
    const { viewport, userAgent, colorScheme, network } = this.emulationState
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
  }
}
