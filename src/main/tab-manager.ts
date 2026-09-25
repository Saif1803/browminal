import type { BrowserWindow, WebContents } from 'electron'
import { INITIAL_CHROME_HEIGHT } from '../shared/layout'
import type { BrowserState } from '../shared/types'
import { HOME_URL, isHomeUrl, isHttpUrl } from '../shared/url'
import { confirmOpenExternal } from './external-links'
import { activeAfterClose, insertionIndex } from './tab-order'
import { Tab, type OpenRequest, type TabHooks } from './tabs'

const MAX_CLOSED_TABS = 25

interface ClosedTab {
  url: string
  index: number
}

interface CreateOptions {
  /** A trusted URL (http(s) or home). Defaults to the home page. */
  url?: string
  background?: boolean
  openerId?: number | null
  index?: number
}

/**
 * Owns the window's tabs: their order, which one is active, and the closed-tab stack.
 * Only the active tab's view is attached to the window; the others keep running detached.
 */
export class TabManager {
  private tabs: Tab[] = []
  private activeTab!: Tab
  private closed: ClosedTab[] = []
  private chromeHeight = INITIAL_CHROME_HEIGHT
  private changeListener: (() => void) | null = null
  private createdListeners: ((tab: Tab) => void)[] = []
  private disposed = false
  /** The tab showing a page in fullscreen (a video), covering the whole window. */
  private fullscreenTab: Tab | null = null
  // Whether the window was already fullscreen (F11) when the page went fullscreen.
  private windowWasFullscreen = false

  private readonly hooks: TabHooks = {
    changed: () => this.notifyChange(),
    opened: (opener, request) => this.openFromPage(opener, request),
    openExternal: (tab, url) => {
      // Only the tab in front may ask; background tabs could otherwise pop dialogs at any time.
      if (tab === this.activeTab) confirmOpenExternal(this.window, tab.url, url)
    },
    fullscreenChanged: (tab, isFullscreen) => this.setPageFullscreen(tab, isFullscreen),
    destroyed: (tab) => this.remove(tab, false)
  }

  constructor(private readonly window: BrowserWindow) {
    this.create()
  }

  get active(): Tab {
    return this.activeTab
  }

  get all(): readonly Tab[] {
    return this.tabs
  }

  get(id: number): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id)
  }

  /** Called on every change to what getState() returns. Often: the listener should batch. */
  onChange(listener: () => void): void {
    this.changeListener = listener
  }

  /** Called for every tab, including ones that already exist. */
  onTabCreated(listener: (tab: Tab) => void): void {
    this.createdListeners.push(listener)
    this.tabs.forEach(listener)
  }

  getState(): Pick<BrowserState, 'tabs' | 'active'> {
    return {
      tabs: this.tabs.map((tab) => tab.getSummary()),
      active: this.activeTab.getActiveState()
    }
  }

  create({ url = HOME_URL, background = false, openerId = null, index }: CreateOptions = {}): Tab {
    const tab = new Tab({ id: nextId(), openerId }, this.hooks)
    this.insert(tab, index ?? insertionIndex(this.tabs, openerId))
    if (!background || !this.activeTab) this.activate(tab.id)
    tab.load(url)
    return tab
  }

  close(id: number): void {
    const tab = this.get(id)
    if (tab) this.remove(tab, true)
  }

  activate(id: number): void {
    const tab = this.get(id)
    if (!tab || this.window.isDestroyed()) return
    const previous = this.activeTab
    this.activeTab = tab
    if (this.fullscreenTab && this.fullscreenTab !== tab) this.fullscreenTab.exitHtmlFullscreen()
    if (previous !== tab) {
      if (previous) this.window.contentView.removeChildView(previous.view)
      this.window.contentView.addChildView(tab.view)
    }
    this.layout()
    tab.webContents.focus()
    this.notifyChange()
  }

  /** Ctrl+Tab / Ctrl+Shift+Tab, wrapping around. */
  activateRelative(offset: number): void {
    const index = this.tabs.indexOf(this.activeTab)
    const count = this.tabs.length
    this.activate(this.tabs[(((index + offset) % count) + count) % count].id)
  }

  /** Ctrl+1–8 (and Ctrl+9 with the last index). */
  activateIndex(index: number): void {
    const tab = this.tabs[index]
    if (tab) this.activate(tab.id)
  }

  /** The window left fullscreen (F11, the green button): a fullscreen page leaves with it. */
  windowLeftFullscreen(): void {
    this.fullscreenTab?.exitHtmlFullscreen()
  }

  /** Esc: a fullscreen page leaves fullscreen. Returns false if there was nothing to do. */
  exitPageFullscreen(): boolean {
    if (!this.fullscreenTab) return false
    this.fullscreenTab.exitHtmlFullscreen()
    return true
  }

  /** Ctrl+Shift+T: reopens the most recently closed tab where it was. */
  reopenClosed(): void {
    const entry = this.closed.pop()
    if (entry) this.create({ url: entry.url, index: Math.min(entry.index, this.tabs.length) })
  }

  /**
   * Closes the tab of `webContents` if it never showed a page: one a link opened (target=_blank)
   * only to start a download. Its opener comes back to the front, like in Chrome.
   */
  closeIfBlank(webContents: WebContents): void {
    const tab = this.tabs.find((other) => other.webContents === webContents)
    if (!tab || webContents.isDestroyed()) return
    const url = webContents.getURL()
    if (url !== '' && url !== 'about:blank') return
    const opener = tab.openerId === null ? undefined : this.get(tab.openerId)
    const wasActive = tab === this.activeTab
    this.close(tab.id)
    if (wasActive && opener) this.activate(opener.id)
  }

  toggleMute(id: number): void {
    this.get(id)?.toggleMute()
  }

  /** The UI's height, reported by the UI itself. Tabs are placed below it. */
  setChromeHeight(height: number): void {
    if (height === this.chromeHeight) return
    this.chromeHeight = height
    this.layout()
  }

  layout(): void {
    if (this.window.isDestroyed()) return
    const { width, height } = this.window.getContentBounds()
    const page = {
      x: 0,
      y: this.chromeHeight,
      width,
      height: Math.max(0, height - this.chromeHeight)
    }
    // Background tabs get sized too, so pages loading there lay out at the right width.
    // A fullscreen page covers the UI.
    for (const tab of this.tabs) {
      tab.setBounds(tab === this.fullscreenTab ? { x: 0, y: 0, width, height } : page)
    }
  }

  /** Destroys every tab. Call when the window closes. */
  dispose(): void {
    this.disposed = true
    this.changeListener = null
    for (const tab of this.tabs) tab.destroy()
    this.tabs = []
  }

  /** A page entered or left HTML fullscreen: the window follows, and the page covers the UI. */
  private setPageFullscreen(tab: Tab, isFullscreen: boolean): void {
    if (this.window.isDestroyed()) return
    if (isFullscreen) {
      // Only the tab in front may take over the window.
      if (tab !== this.activeTab) {
        tab.exitHtmlFullscreen()
        return
      }
      if (!this.fullscreenTab) this.windowWasFullscreen = this.window.isFullScreen()
      this.fullscreenTab = tab
      this.window.setFullScreen(true)
    } else {
      if (tab !== this.fullscreenTab) return
      this.fullscreenTab = null
      if (!this.windowWasFullscreen) this.window.setFullScreen(false)
    }
    this.layout()
  }

  /** A tab for something a page opened (window.open, target=_blank, middle-click), next to it. */
  private openFromPage(
    opener: Tab,
    { webContents, details, background }: OpenRequest
  ): WebContents {
    const tab = new Tab({ id: nextId(), openerId: opener.id, webContents }, this.hooks)
    this.insert(tab, insertionIndex(this.tabs, opener.id))
    if (!background) this.activate(tab.id)
    if (!webContents) tab.loadOpened(details)
    return tab.webContents
  }

  private insert(tab: Tab, index: number): void {
    this.tabs.splice(index, 0, tab)
    for (const listener of this.createdListeners) listener(tab)
    this.layout()
    this.notifyChange()
  }

  /**
   * Takes a tab out of the window. `byUser` means we're closing it (so remember it for
   * reopening); otherwise its webContents is already gone (window.close(), teardown).
   */
  private remove(tab: Tab, byUser: boolean): void {
    const index = this.tabs.indexOf(tab)
    if (this.disposed || index === -1) return

    if (byUser && isReopenable(tab.url)) {
      this.closed.push({ url: tab.url, index })
      if (this.closed.length > MAX_CLOSED_TABS) this.closed.shift()
    }

    const nextActiveId = activeAfterClose(this.tabs, tab.id, this.activeTab.id)
    this.tabs.splice(index, 1)
    for (const other of this.tabs) if (other.openerId === tab.id) other.openerId = null
    if (tab === this.fullscreenTab) this.setPageFullscreen(tab, false)
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view)
    tab.destroy()

    if (nextActiveId === null) {
      // Closing the last tab leaves a fresh home tab, not an empty window.
      this.create()
    } else if (nextActiveId !== this.activeTab.id) {
      this.activate(nextActiveId)
    }
    this.notifyChange()
  }

  private notifyChange(): void {
    if (!this.disposed) this.changeListener?.()
  }
}

/** Only pages main would load itself are remembered (an error page as the URL that failed). */
const isReopenable = (url: string): boolean => isHttpUrl(url) || isHomeUrl(url)

let lastId = 0
const nextId = (): number => ++lastId
