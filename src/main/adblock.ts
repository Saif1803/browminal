import {
  net,
  session,
  type CallbackResponse,
  type OnBeforeRequestListenerDetails,
  type WebContents,
  type WebFrameMain
} from 'electron'
import { rename, stat } from 'fs/promises'
import { join } from 'path'
import { Worker } from 'worker_threads'
import type { ShieldState } from '../shared/types'
import workerPath from './adblock-worker?modulePath'
import { cosmeticStyles, loadEngine, shouldBlock, type AdblockEngine } from './adblock-filters'
import { nativePath } from './native'
import {
  emptySeenTokens,
  FILTER_LISTS,
  isUpdateDue,
  parseDomTokens,
  shieldStatus,
  siteOf,
  takeUnseen,
  togglePausedSite,
  type EngineStatus,
  type SeenTokens
} from './adblock-policy'
import type { Settings } from './settings'
import type { JsonStore } from './store'

const CACHE_FILE = 'adblock-engine.bin'
const CHECK_INTERVAL_MS = 15 * 60 * 1000
const FETCH_TIMEOUT_MS = 60_000
// Blocked counts change in bursts while a page loads; the shield catches up this often.
const COUNT_DELAY_MS = 250
// The page scan runs in its own JavaScript world, which the page's scripts can't see or change.
// (0 is the page's world, 999 Electron's preload world.)
const SCAN_WORLD_ID = 2001

/**
 * Collects the class names and ids on the page, so the engine can pick the generic
 * element-hiding rules that apply.
 */
const SCAN_PAGE = `(() => {
  const max = 5000
  const classes = new Set(), ids = new Set()
  const skip = new Set(['BR', 'HEAD', 'LINK', 'META', 'SCRIPT', 'STYLE', 'S'])
  const selector = '[id]:not(html):not(body),[class]:not(html):not(body)'
  for (const element of document.querySelectorAll(selector)) {
    if (skip.has(element.nodeName.toUpperCase())) continue
    const id = element.getAttribute('id')
    if (id && ids.size < max) ids.add(id)
    for (const name of element.classList) if (classes.size < max) classes.add(name)
  }
  return { classes: [...classes], ids: [...ids] }
})()`

/** What the ad blocker keeps per tab page; reset when the tab goes to another page. */
interface Page {
  webContents: WebContents
  blocked: number
  /** Whether the site's own and the generic hiding rules are in the page yet. */
  styled: boolean
  seen: SeenTokens
}

/** Fetches with main's network stack (system proxy settings), failing on HTTP errors. */
async function fetchList(url: string): Promise<string> {
  const response = await net.fetch(url, {
    credentials: 'omit',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

/** Parses the lists in a worker thread; resolves with the engine's bytes. */
function buildInWorker(lists: string, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: nativePath })
    worker.once('message', () => {
      resolve()
      worker.terminate()
    })
    worker.once('error', reject)
    worker.once('exit', (code) => reject(new Error(`Filter worker exited (${code})`)))
    worker.postMessage({ lists, file })
  })
}

/** The frame a request belongs to; a frame's own page request belongs to its parent. */
function sourceFrameUrl(details: OnBeforeRequestListenerDetails): string | null {
  try {
    const frame: WebFrameMain | null | undefined =
      details.resourceType === 'subFrame' ? details.frame?.parent : details.frame
    return frame?.url || null
  } catch {
    // The frame is already gone.
    return null
  }
}

/**
 * The ad blocker: Brave's filter engine (adblock-rust, in our native module) with the EasyList,
 * EasyPrivacy, Peter Lowe's and uBlock Origin lists. Lives for the whole app, like Downloads.
 * - Network: our own webRequest handler cancels matching requests from tabs. Pages themselves
 *   are never blocked, and neither is anything on a paused site.
 * - Element hiding: main inserts the engine's CSS into each tab page (no preload involved).
 * - The engine is cached in userData/adblock-engine.bin and downloaded again once a day.
 *   Until there is one (first run, offline), nothing is blocked.
 */
export class Adblock {
  private engine: AdblockEngine | null = null
  private engineStatus: EngineStatus = 'loading'
  private lastUpdated: number | null = null
  private lastAttempt: number | null = null
  private updating = false
  private listening = false
  // By webContents id, for every tab.
  private pages = new Map<number, Page>()
  private listeners = new Set<() => void>()
  private countTimer: ReturnType<typeof setTimeout> | null = null
  private readonly cachePath: string

  constructor(
    folder: string,
    private readonly settings: JsonStore<Settings>
  ) {
    this.cachePath = join(folder, CACHE_FILE)
    this.syncRequestHandler()
    this.loadCache().finally(() => this.checkForUpdate())
    setInterval(() => this.checkForUpdate(), CHECK_INTERVAL_MS)
  }

  /** Called when the shield of any tab may have changed. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get enabled(): boolean {
    return this.settings.get().adblock.enabled
  }

  /** The shield for a tab showing `url` (as the address bar shows it); null off the web. */
  shieldFor(url: string, webContents: WebContents): ShieldState | null {
    const site = siteOf(url)
    if (!site) return null
    const status = shieldStatus({
      enabled: this.enabled,
      paused: this.isPaused(site),
      engine: this.engineStatus
    })
    return { status, site, blocked: this.pages.get(webContents.id)?.blocked ?? 0 }
  }

  /** Turns blocking on or off everywhere. */
  setEnabled(enabled: boolean): void {
    this.saveSettings({ ...this.settings.get().adblock, enabled })
    this.syncRequestHandler()
    this.checkForUpdate()
  }

  /** Pauses blocking on `site`, or resumes it. */
  togglePaused(site: string): void {
    const adblock = this.settings.get().adblock
    this.saveSettings({ ...adblock, pausedSites: togglePausedSite(adblock.pausedSites, site) })
  }

  /** "Try again" after the lists couldn't be downloaded. */
  retry(): void {
    this.checkForUpdate(true)
  }

  /** Starts counting and hiding ads in a tab. Call once for every tab. */
  attach(webContents: WebContents): void {
    const id = webContents.id
    const page: Page = { webContents, blocked: 0, styled: false, seen: emptySeenTokens() }
    this.pages.set(id, page)
    webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return
      page.blocked = 0
      page.styled = false
      page.seen = emptySeenTokens()
      this.countChanged()
    })
    // Hide what's there once the document is parsed, then what arrived by the end of loading,
    // and again when a single-page app moves to another page.
    const hide = (): void => {
      this.hideAds(page).catch((error) => console.error('Ad blocker could not hide ads:', error))
    }
    webContents.on('dom-ready', hide)
    webContents.on('did-stop-loading', hide)
    webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) hide()
    })
    webContents.once('destroyed', () => this.pages.delete(id))
  }

  private isPaused(site: string): boolean {
    return this.settings.get().adblock.pausedSites.includes(site)
  }

  /** Whether ads are blocked on the page at `url`. */
  private isBlockingOn(url: string): boolean {
    const site = siteOf(url)
    return this.enabled && site !== null && !this.isPaused(site)
  }

  private saveSettings(adblock: Settings['adblock']): void {
    this.settings.set({ ...this.settings.get(), adblock })
    this.changed()
  }

  /** Our webRequest handler is only there while blocking is on, so it costs nothing when off. */
  private syncRequestHandler(): void {
    if (this.enabled === this.listening) return
    this.listening = this.enabled
    session.defaultSession.webRequest.onBeforeRequest(this.listening ? this.onBeforeRequest : null)
  }

  private readonly onBeforeRequest = (
    details: OnBeforeRequestListenerDetails,
    callback: (response: CallbackResponse) => void
  ): void => {
    let block = false
    try {
      block = this.shouldBlockRequest(details)
    } catch (error) {
      console.error('Ad blocker failed on a request:', error)
    }
    callback(block ? { cancel: true } : {})
  }

  private shouldBlockRequest(details: OnBeforeRequestListenerDetails): boolean {
    const engine = this.engine
    // Only requests from tabs: not the UI, main's own fetches or service workers.
    const page =
      details.webContentsId === undefined ? undefined : this.pages.get(details.webContentsId)
    if (!engine || !page || details.resourceType === 'mainFrame') return false
    const pageUrl = page.webContents.getURL()
    if (!this.isBlockingOn(pageUrl)) return false
    const sourceUrl = sourceFrameUrl(details) ?? pageUrl
    const { url, resourceType: type, method } = details
    if (!shouldBlock(engine, { url, type, sourceUrl, method })) return false
    page.blocked++
    this.countChanged()
    return true
  }

  /** Inserts the CSS that hides ads: the site's and the generic rules, then rules for what's on the page. */
  private async hideAds(page: Page): Promise<void> {
    const { webContents, seen } = page
    const engine = this.engine
    if (!engine || webContents.isDestroyed()) return
    const url = webContents.getURL()
    if (!this.isBlockingOn(url)) return

    if (!page.styled) {
      page.styled = true
      this.insertCss(webContents, cosmeticStyles(engine, url, null))
    }
    const found = await webContents
      .executeJavaScriptInIsolatedWorld(SCAN_WORLD_ID, [{ code: SCAN_PAGE }])
      .catch(() => null)
    // The tab may have gone to another page meanwhile.
    if (webContents.isDestroyed() || page.seen !== seen) return
    const tokens = takeUnseen(seen, parseDomTokens(found))
    if (tokens) this.insertCss(webContents, cosmeticStyles(engine, url, tokens))
  }

  private insertCss(webContents: WebContents, css: string): void {
    if (css) webContents.insertCSS(css, { cssOrigin: 'user' }).catch(() => {})
  }

  private async loadCache(): Promise<void> {
    try {
      const [engine, info] = await Promise.all([loadEngine(this.cachePath), stat(this.cachePath)])
      if (!engine || this.engine) return
      this.engine = engine
      this.engineStatus = 'ready'
      this.lastUpdated = info.mtimeMs
      this.changed()
    } catch {
      // No cache yet: the first update downloads the lists.
    }
  }

  private checkForUpdate(force = false): void {
    if (this.updating || !this.enabled) return
    const times = { lastUpdated: this.lastUpdated, lastAttempt: this.lastAttempt, now: Date.now() }
    if (force || isUpdateDue(times)) void this.update()
  }

  /** Downloads the lists, builds a new engine off the main thread, and switches to it. */
  private async update(): Promise<void> {
    this.updating = true
    this.lastAttempt = Date.now()
    if (!this.engine) {
      this.engineStatus = 'loading'
      this.changed()
    }
    try {
      const lists = await Promise.all(FILTER_LISTS.map(fetchList))
      // The worker saves the new engine beside the cache, which it replaces once it has loaded.
      const temp = `${this.cachePath}.tmp`
      await buildInWorker(lists.join('\n'), temp)
      const engine = await loadEngine(temp)
      if (!engine) throw new Error('The new filter engine could not be loaded')
      this.engine = engine
      this.engineStatus = 'ready'
      this.lastUpdated = Date.now()
      await this.replaceCache(temp)
    } catch (error) {
      console.error('Could not update the ad blocker filter lists:', error)
      if (!this.engine) this.engineStatus = 'failed'
    } finally {
      this.updating = false
      this.changed()
    }
  }

  /** Atomic, like JsonStore's writes; a failure only means downloading again next start. */
  private async replaceCache(temp: string): Promise<void> {
    try {
      await rename(temp, this.cachePath)
    } catch (error) {
      console.error(`Could not save ${this.cachePath}:`, error)
    }
  }

  private countChanged(): void {
    if (this.countTimer !== null) return
    this.countTimer = setTimeout(() => {
      this.countTimer = null
      this.changed()
    }, COUNT_DELAY_MS)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}
