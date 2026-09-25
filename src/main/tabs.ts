import {
  WebContentsView,
  type HandlerDetails,
  type Rectangle,
  type WebContents,
  type WebPreferences
} from 'electron'
import type { ActiveTabState, TabSummary } from '../shared/types'
import { HOME_URL, isHomeUrl, resolveInput } from '../shared/url'
import { loadFavicon, pickFaviconUrl } from './favicons'

const PAGE_BACKGROUND = '#ffffff'
// Matches the home page, so it doesn't flash white while loading.
const HOME_BACKGROUND = '#0f0d17'

/** Every tab, including ones pages open with window.open, gets exactly these. */
const TAB_WEB_PREFERENCES: WebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  // Deliberately no preload: web pages must never see our API.
  webSecurity: true,
  webviewTag: false
}

/** Pages may only open new tabs on http(s), or blank ones they fill in themselves (OAuth popups). */
function canOpenInTab(url: string): boolean {
  return url === '' || url === 'about:blank' || /^https?:\/\//i.test(url)
}

/** How a tab reports back to its TabManager. */
export interface TabHooks {
  /** Something the UI shows changed. Called often; the manager batches. */
  changed(tab: Tab): void
  /** The page opened a window (window.open, target=_blank, middle-click). Returns the new tab's page. */
  opened(opener: Tab, request: OpenRequest): WebContents
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

    const changed = (): void => {
      if (!this.isDestroyed) this.hooks.changed(this)
    }
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        this.view.setBackgroundColor(isHomeUrl(details.url) ? HOME_BACKGROUND : PAGE_BACKGROUND)
      }
    })
    wc.on('did-navigate', () => {
      // A new document: forget the old page's icon until the new one reports its own.
      this.favicon = null
      this.faviconRequest++
      changed()
    })
    wc.on('page-favicon-updated', (_event, favicons) => this.updateFavicon(favicons))
    wc.on('did-navigate-in-page', changed)
    wc.on('page-title-updated', changed)
    wc.on('did-start-loading', changed)
    wc.on('did-stop-loading', changed)
    wc.on('did-fail-load', changed)
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

  get url(): string {
    return this.webContents.getURL()
  }

  getSummary(): TabSummary {
    const wc = this.webContents
    const url = wc.getURL()
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
    const url = wc.getURL()
    return {
      id: this.id,
      url,
      title: wc.getTitle() || url,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading()
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

  reload(): void {
    this.webContents.reload()
  }

  stop(): void {
    this.webContents.stop()
  }

  toggleMute(): void {
    this.webContents.setAudioMuted(!this.webContents.isAudioMuted())
    this.hooks.changed(this)
  }

  setBounds(bounds: Rectangle): void {
    this.view.setBounds(bounds)
  }

  /** Closes the page. Hooks are not called after this. */
  destroy(): void {
    this.isDestroyed = true
    if (!this.webContents.isDestroyed()) this.webContents.close()
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
