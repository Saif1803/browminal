import { WebContentsView, type Rectangle } from 'electron'
import type { TabState } from '../shared/types'
import { resolveInput } from '../shared/url'

type StateListener = (state: TabState) => void

/**
 * One browsing tab: a sandboxed WebContentsView with no preload and no Node access.
 * Milestone 1 has a single tab, but everything tab-specific lives here so more can be added.
 */
export class Tab {
  readonly view: WebContentsView
  private listener: StateListener | null = null

  constructor() {
    this.view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Deliberately no preload: web pages must never see our API.
        webSecurity: true
      }
    })
    this.view.setBackgroundColor('#ffffff')

    const wc = this.view.webContents
    // New windows are not supported yet; deny all of them (window.open, target=_blank, etc.).
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    // Pages must not be able to embed <webview>, which could bypass these preferences.
    wc.on('will-attach-webview', (event) => event.preventDefault())

    const emit = (): void => this.listener?.(this.getState())
    wc.on('did-navigate', emit)
    wc.on('did-navigate-in-page', emit)
    wc.on('page-title-updated', emit)
    wc.on('did-start-loading', emit)
    wc.on('did-stop-loading', emit)
    wc.on('did-fail-load', emit)
  }

  get webContents(): Electron.WebContents {
    return this.view.webContents
  }

  onStateChange(listener: StateListener): void {
    this.listener = listener
  }

  getState(): TabState {
    const wc = this.view.webContents
    const url = wc.getURL()
    return {
      url,
      title: wc.getTitle() || url,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading()
    }
  }

  /** Address-bar input: resolved to an http(s) URL or a search in resolveInput. */
  navigate(input: string): void {
    this.view.webContents.loadURL(resolveInput(input)).catch(() => {
      // Load failures (DNS errors, aborts) are reported through did-fail-load.
    })
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

  setBounds(bounds: Rectangle): void {
    this.view.setBounds(bounds)
  }

  destroy(): void {
    this.listener = null
    if (!this.webContents.isDestroyed()) this.webContents.close()
  }
}
