import {
  WebContentsView,
  type HandlerDetails,
  type Rectangle,
  type WebContents,
  type WebPreferences
} from 'electron'
import type { ActiveTabState, FindState, TabSummary } from '../shared/types'
import {
  HOME_URL,
  INTERNAL_SCHEME,
  displayUrl,
  errorPageUrl,
  isHomeUrl,
  isHttpUrl,
  parseErrorPageUrl,
  resolveInput
} from '../shared/url'
import { loadFavicon, pickFaviconUrl } from './favicons'
import { decideNavigation } from './navigation-policy'
import { nextZoomFactor } from './zoom-levels'

const PAGE_BACKGROUND = '#ffffff'
// Matches the internal pages, so they don't flash white while loading.
const INTERNAL_BACKGROUND = '#0f0d17'
// net::ERR_ABORTED: the navigation was replaced or stopped; not an error to show.
const ERR_ABORTED = -3

/** Every tab, including ones pages open with window.open, gets exactly these. */
const TAB_WEB_PREFERENCES: WebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  // Deliberately no preload: web pages must never see our API.
  webSecurity: true,
  webviewTag: false
}

/** Pages may only open new tabs on http(s), blob: URLs they made, or blank ones they fill in themselves (OAuth popups). */
function canOpenInTab(url: string): boolean {
  return url === '' || url === 'about:blank' || isHttpUrl(url) || url.startsWith('blob:')
}

/** How a tab reports back to its TabManager. */
export interface TabHooks {
  /** Something the UI shows changed. Called often; the manager batches. */
  changed(tab: Tab): void
  /** The page opened a window (window.open, target=_blank, middle-click). Returns the new tab's page. */
  opened(opener: Tab, request: OpenRequest): WebContents
  /** The page asked to open a mailto:/tel: link in another app. */
  openExternal(tab: Tab, url: string): void
  /** The page entered or left fullscreen (a video's fullscreen button). */
  fullscreenChanged(tab: Tab, isFullscreen: boolean): void
  /** The webContents is gone: the page called window.close(), or the tab was destroyed. */
  destroyed(tab: Tab): void
}

export interface OpenRequest {
  /**
   * The page Chromium already created for window.open; adopting it keeps window.opener
   * working (OAuth popups). Absent for links opened with middle-click or a modifier key:
   * the new tab then loads `details` itself.
   */
  webContents?: WebContents
  details: HandlerDetails
  background: boolean
}

export interface TabOptions {
  id: number
  openerId: number | null
  /** Adopt this webContents (from window.open) instead of creating one. */
  webContents?: WebContents
}

/** One browsing tab: a sandboxed WebContentsView with no preload and no Node access. */
export class Tab {
  readonly id: number
  /** The tab whose page opened this one; used to place new tabs next to it. */
  openerId: number | null
  readonly view: WebContentsView
  private favicon: string | null = null
  // Bumped on every navigation so a slow favicon fetch can't land on the next page.
  private faviconRequest = 0
  /** Null while the find bar is closed. */
  private find: FindState | null = null
  // found-in-page results for older searches are ignored.
  private findRequest = 0
  private isDestroyed = false

  constructor(
    options: TabOptions,
    private readonly hooks: TabHooks
  ) {
    this.id = options.id
    this.openerId = options.openerId
    this.view = options.webContents
      ? new WebContentsView({ webContents: options.webContents })
      : new WebContentsView({ webPreferences: TAB_WEB_PREFERENCES })
    this.view.setBackgroundColor(PAGE_BACKGROUND)

    const wc = this.view.webContents
    wc.setWindowOpenHandler((details) => {
      if (decideNavigation(details.url) === 'external') {
        this.hooks.openExternal(this, details.url)
        return { action: 'deny' }
      }
      if (!canOpenInTab(details.url)) return { action: 'deny' }
      return {
        action: 'allow',
        // Closing this tab must not close the tabs it opened.
        outlivesOpener: true,
        // Applied to the new webContents before it's created; the renderer can't loosen them.
        overrideBrowserWindowOptions: { webPreferences: TAB_WEB_PREFERENCES },
        createWindow: (childOptions) =>
          this.hooks.opened(this, {
            webContents: (childOptions as { webContents?: WebContents }).webContents,
            details,
            background: details.disposition === 'background-tab'
          })
      }
    })
    // Pages must not be able to embed <webview>, which could bypass these preferences.
    wc.on('will-attach-webview', (event) => event.preventDefault())
    // Links, forms, scripts and redirects: see decideNavigation. Main's own loads don't pass here.
    wc.on('will-frame-navigate', (event) => this.guardNavigation(event, event.url))
    wc.on('will-redirect', (event) => this.guardNavigation(event, event.url))

    const changed = (): void => {
      if (!this.isDestroyed) this.hooks.changed(this)
    }
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        const internal = details.url.startsWith(`${INTERNAL_SCHEME}:`)
        this.view.setBackgroundColor(internal ? INTERNAL_BACKGROUND : PAGE_BACKGROUND)
      }
    })
    wc.on('did-navigate', () => {
      // A new document: forget the old page's icon until the new one reports its own.
      this.favicon = null
      this.faviconRequest++
      if (this.find) this.find = { ...this.find, activeMatch: 0, matches: 0 }
      this.collapseErrorEntries()
      changed()
    })
    wc.on('did-fail-load', (_event, code, name, url, isMainFrame) => {
      if (isMainFrame && code !== ERR_ABORTED && isHttpUrl(url)) this.showError(name, url)
      changed()
    })
    wc.on('render-process-gone', (_event, { reason }) => {
      if (reason === 'clean-exit' || this.isDestroyed) return
      const url = displayUrl(wc.getURL())
      if (isHttpUrl(url)) this.showError('CRASHED', url)
      else wc.reload()
    })
    wc.on('page-favicon-updated', (_event, favicons) => this.updateFavicon(favicons))
    wc.on('found-in-page', (_event, result) => {
      if (!this.find || result.requestId !== this.findRequest) return
      this.find = { ...this.find, activeMatch: result.activeMatchOrdinal, matches: result.matches }
      changed()
    })
    // Ctrl+wheel and pinch: Electron reports the request but leaves zooming to us.
    wc.on('zoom-changed', (_event, direction) => this.zoom(direction))
    wc.on('enter-html-full-screen', () => this.hooks.fullscreenChanged(this, true))
    wc.on('leave-html-full-screen', () => this.hooks.fullscreenChanged(this, false))
    wc.on('did-navigate-in-page', changed)
    wc.on('page-title-updated', changed)
    wc.on('did-start-loading', changed)
    wc.on('did-stop-loading', changed)
    wc.on('audio-state-changed', changed)
    wc.once('destroyed', () => {
      if (this.isDestroyed) return
      this.isDestroyed = true
      this.hooks.destroyed(this)
    })
  }

  get webContents(): WebContents {
    return this.view.webContents
  }

  /** The page's URL as the user sees it: error pages show the URL that failed. */
  get url(): string {
    return displayUrl(this.webContents.getURL())
  }

  getSummary(): TabSummary {
    const wc = this.webContents
    const url = this.url
    return {
      id: this.id,
      url,
      title: wc.getTitle() || url,
      favicon: this.favicon,
      isLoading: wc.isLoading(),
      isAudible: wc.isCurrentlyAudible(),
      isMuted: wc.isAudioMuted()
    }
  }

  getActiveState(): ActiveTabState {
    const wc = this.webContents
    const url = this.url
    return {
      id: this.id,
      url,
      title: wc.getTitle() || url,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading(),
      isErrorPage: parseErrorPageUrl(wc.getURL()) !== null,
      zoomFactor: wc.getZoomFactor(),
      find: this.find
    }
  }

  /** Address-bar input: resolved to an http(s) URL or a search in resolveInput. */
  navigate(input: string): void {
    this.load(resolveInput(input))
  }

  /** Loads a URL main already trusts (http(s) or the home page). */
  load(url: string): void {
    if (isHomeUrl(url)) {
      this.goHome()
      return
    }
    this.webContents.loadURL(url).catch(() => {
      // Load failures (DNS errors, aborts) are reported through did-fail-load.
    })
  }

  /** Loads what another tab asked to open (see OpenRequest), keeping its referrer and form data. */
  loadOpened({ url, referrer, postBody }: HandlerDetails): void {
    const post = postBody && {
      postData: postBody.data,
      extraHeaders: `content-type: ${postBody.contentType}${postBody.boundary ? `; boundary=${postBody.boundary}` : ''}`
    }
    this.webContents.loadURL(url, { httpReferrer: referrer, ...post }).catch(() => {})
  }

  goHome(): void {
    this.webContents.loadURL(HOME_URL).catch(() => {})
    // Put the cursor in the home page's prompt box.
    this.webContents.focus()
  }

  back(): void {
    if (this.webContents.navigationHistory.canGoBack()) this.webContents.navigationHistory.goBack()
  }

  forward(): void {
    if (this.webContents.navigationHistory.canGoForward())
      this.webContents.navigationHistory.goForward()
  }

  /** On an error page this retries the URL that failed. */
  reload(ignoreCache = false): void {
    const failed = parseErrorPageUrl(this.webContents.getURL())
    if (failed) this.load(failed.url)
    else if (ignoreCache) this.webContents.reloadIgnoringCache()
    else this.webContents.reload()
  }

  stop(): void {
    this.webContents.stop()
  }

  print(): void {
    this.webContents.print({}, () => {
      // Cancelled or failed prints need no handling.
    })
  }

  toggleDevTools(): void {
    if (this.webContents.isDevToolsOpened()) this.webContents.closeDevTools()
    else this.webContents.openDevTools({ mode: 'detach' })
  }

  inspectElement(x: number, y: number): void {
    if (!this.webContents.isDevToolsOpened()) this.webContents.openDevTools({ mode: 'detach' })
    this.webContents.inspectElement(x, y)
  }

  toggleMute(): void {
    this.webContents.setAudioMuted(!this.webContents.isAudioMuted())
    this.hooks.changed(this)
  }

  /** Zoom is per site: Chromium applies it to every tab on the same host. */
  zoom(direction: 'in' | 'out'): void {
    this.webContents.setZoomFactor(nextZoomFactor(this.webContents.getZoomFactor(), direction))
    this.hooks.changed(this)
  }

  resetZoom(): void {
    this.webContents.setZoomFactor(1)
    this.hooks.changed(this)
  }

  /** Opens the find bar, searching again for the last text if there was one. */
  openFind(): void {
    this.findText(this.find?.query ?? '')
  }

  /** A new search for `query` as it's typed. An empty query clears the highlights. */
  findText(query: string): void {
    this.find = { query, activeMatch: 0, matches: 0 }
    if (query) this.findRequest = this.webContents.findInPage(query, { findNext: true })
    else this.webContents.stopFindInPage('clearSelection')
    this.hooks.changed(this)
  }

  /** Enter / Shift+Enter in the find bar. */
  findAgain(forward: boolean): void {
    if (!this.find?.query) return
    this.findRequest = this.webContents.findInPage(this.find.query, { forward, findNext: false })
  }

  isFindOpen(): boolean {
    return this.find !== null
  }

  /** Closes the find bar, keeping the current match selected, and returns focus to the page. */
  closeFind(): void {
    if (!this.find) return
    this.find = null
    this.webContents.stopFindInPage('keepSelection')
    this.webContents.focus()
    this.hooks.changed(this)
  }

  /** Asks the page to leave HTML fullscreen (switching tabs, leaving window fullscreen). */
  exitHtmlFullscreen(): void {
    this.webContents
      .executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true)
      .catch(() => {})
  }

  setBounds(bounds: Rectangle): void {
    this.view.setBounds(bounds)
  }

  /** Closes the page. Hooks are not called after this. */
  destroy(): void {
    this.isDestroyed = true
    if (!this.webContents.isDestroyed()) this.webContents.close()
  }

  private guardNavigation(event: Electron.Event, url: string): void {
    const decision = decideNavigation(url)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') this.hooks.openExternal(this, url)
  }

  /** Replaces a failed load with nebula://error/, which shows the failed URL in the address bar. */
  private showError(code: string, url: string): void {
    // Not from inside did-fail-load: let Chromium finish with the failed navigation first.
    setImmediate(() => {
      if (!this.isDestroyed) this.webContents.loadURL(errorPageUrl(code, url)).catch(() => {})
    })
  }

  /**
   * Keeps history free of failed loads, like other browsers: an error page takes the place of
   * the failed load's own blank entry, and a successful retry takes the place of the error page.
   */
  private collapseErrorEntries(): void {
    const history = this.webContents.navigationHistory
    const index = history.getActiveIndex()
    if (index < 1) return
    const entries = history.getAllEntries()
    const current = entries[index].url
    const failed = parseErrorPageUrl(current)
    if (!failed && parseErrorPageUrl(entries[index - 1].url)?.url !== current) return

    const target = failed?.url ?? current
    const isSameAttempt = (url: string): boolean =>
      url === target || parseErrorPageUrl(url)?.url === target
    for (let i = index - 1; i >= 0 && isSameAttempt(entries[i].url); i--) {
      history.removeEntryAtIndex(i)
    }
  }

  private updateFavicon(candidates: string[]): void {
    const url = pickFaviconUrl(candidates)
    const request = ++this.faviconRequest
    if (!url) {
      this.favicon = null
      this.hooks.changed(this)
      return
    }
    loadFavicon(url).then((favicon) => {
      if (this.isDestroyed || request !== this.faviconRequest) return
      this.favicon = favicon
      this.hooks.changed(this)
    })
  }
}
