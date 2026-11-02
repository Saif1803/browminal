import type { BrowserWindow, WebContents } from 'electron'
import { INITIAL_CHROME_HEIGHT, PAGE_RADIUS, windowLayout, type Rect } from '../shared/layout'
import type { TabSummary } from '../shared/types'
import { HOME_URL, isHomeUrl, isHttpUrl } from '../shared/url'
import { confirmOpenExternal } from './external-links'
import { PageVeil } from './page-veil'
import { activeAfterClose, insertionIndex } from './tab-order'
import { Tab, type OpenRequest, type TabActiveState, type TabHooks } from './tabs'

const MAX_CLOSED_TABS = 25
// Switching tabs keeps the old page on screen until the new one has drawn a frame, or this long.
const SWITCH_FRAME_TIMEOUT_MS = 250
// The veil fades in over a page that's being replaced, and out once the new one has drawn.
const VEIL_FADE_IN_MS = 120
const VEIL_FADE_OUT_MS = 220

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
 * Only the tab on screen has its view attached; the others keep running detached. The window
 * never shows a blank page: while the active tab's next view hasn't drawn, the one before stays
 * on top (see show), and a page loading in the tab on screen is veiled until it draws.
 */
export class TabManager {
  private tabs: Tab[] = []
  private activeTab!: Tab
  private closed: ClosedTab[] = []
  private chromeHeight = INITIAL_CHROME_HEIGHT
  /** The terminal panel's height while it's open (it takes space from the page), else null. */
  private panelHeight: number | null = null
  private layoutListeners: ((terminal: Rect | null) => void)[] = []
  private changeListener: (() => void) | null = null
  private createdListeners: ((tab: Tab) => void)[] = []
  private faviconListeners: ((url: string, favicon: string) => void)[] = []
  private disposed = false
  /** The tab showing a page in fullscreen (a video), covering the whole window. */
  private fullscreenTab: Tab | null = null
  // Whether the window was already fullscreen (F11) when the page went fullscreen.
  private windowWasFullscreen = false
  /** The tab whose view is on top. Differs from activeTab while a switch waits for a frame. */
  private shownTab: Tab | null = null
  // Bumped by every show(), so a slower earlier switch can't finish after a newer one.
  private showRequest = 0
  // Closed while on screen: kept up until the next tab can take its place, then destroyed.
  private retiring = new Set<Tab>()
  private readonly veil: PageVeil

  private readonly hooks: TabHooks = {
    changed: () => this.notifyChange(),
    opened: (opener, request) => this.openFromPage(opener, request),
    openExternal: (tab, url) => {
      // Only the tab in front may ask; background tabs could otherwise pop dialogs at any time.
      if (tab === this.activeTab) confirmOpenExternal(this.window, tab.url, url)
    },
    fullscreenChanged: (tab, isFullscreen) => this.setPageFullscreen(tab, isFullscreen),
    destroyed: (tab) => this.remove(tab, false),
    faviconLoaded: (tab, favicon) => {
      for (const listener of this.faviconListeners) listener(tab.url, favicon)
    },
    paintChanged: (tab) => {
      if (tab === this.activeTab) this.updateVeil(true)
    }
  }

  constructor(private readonly window: BrowserWindow) {
    this.veil = new PageVeil(window.contentView, () => {
      if (!this.disposed) this.activeTab.webContents.focus()
    })
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

  /** Called with a page's URL whenever a tab has fetched its favicon. */
  onFaviconLoaded(listener: (url: string, favicon: string) => void): void {
    this.faviconListeners.push(listener)
  }

  getState(): { tabs: Omit<TabSummary, 'agentShared'>[]; active: TabActiveState } {
    return {
      tabs: this.tabs.map((tab) => tab.getSummary()),
      active: this.activeTab.getActiveState()
    }
  }

  create({ url = HOME_URL, background = false, openerId = null, index }: CreateOptions = {}): Tab {
    const tab = new Tab({ id: nextId(), openerId }, this.hooks)
    this.insert(tab, index ?? insertionIndex(this.tabs, openerId))
    // Loading first lets activate() see where it's going (a nebula:// page shows no white).
    tab.load(url)
    if (!background || !this.activeTab) this.activate(tab.id)
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
    if (previous !== tab) this.show(tab)
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

  /** The UI's height (see setChromeHeight). */
  get uiHeight(): number {
    return this.chromeHeight
  }

  /** The terminal panel opened (with its height) or closed (null): the page makes room. */
  setPanelHeight(height: number | null): void {
    if (height === this.panelHeight) return
    this.panelHeight = height
    this.layout()
  }

  /** Called after every layout with where the terminal view goes (null: hidden). */
  onLayout(listener: (terminal: Rect | null) => void): void {
    this.layoutListeners.push(listener)
  }

  layout(): void {
    if (this.window.isDestroyed()) return
    const { width, height } = this.window.getContentBounds()
    // The page sits inset from the window's sides and bottom (and the terminal panel, when it's
    // open), with rounded corners. A fullscreen page covers the panel too.
    const { page, terminal } = windowLayout(
      width,
      height,
      this.chromeHeight,
      this.fullscreenTab ? null : this.panelHeight
    )
    // Background tabs get sized too, so pages loading there lay out at the right width.
    // A fullscreen page covers the whole window, UI and margins, with square corners.
    for (const tab of this.tabs) {
      if (tab === this.fullscreenTab) tab.setBounds({ x: 0, y: 0, width, height }, 0)
      else tab.setBounds(page, PAGE_RADIUS)
    }
    if (this.activeTab) this.veil.setBounds(this.activeTab.bounds, this.activeTab.cornerRadius)
    for (const listener of this.layoutListeners) listener(terminal)
  }

  /** Destroys every tab. Call when the window closes. */
  dispose(): void {
    this.disposed = true
    this.changeListener = null
    this.faviconListeners = []
    this.layoutListeners = []
    for (const tab of [...this.tabs, ...this.retiring]) tab.destroy()
    this.tabs = []
    this.retiring.clear()
    this.veil.destroy()
  }

  /**
   * Puts `tab`'s view on screen. A detached view has usually dropped its last frame and would
   * show a blank page until it draws again, so the view on screen stays on top until then; a tab
   * whose page hasn't drawn at all (just opened from a link) is waited for too.
   */
  private show(tab: Tab): void {
    const request = ++this.showRequest
    const current = this.shownTab
    // A nebula:// page that hasn't drawn shows the theme's page colour, so it can go up at once.
    if (!current || current === tab || (!tab.isPainted && tab.hasThemedBackground)) {
      this.reveal(tab)
      return
    }
    // Beneath the page on screen, so it can draw unseen.
    this.window.contentView.addChildView(tab.view, 0)
    const ready = async (): Promise<void> => {
      await tab.whenPainted()
      await tab.nextFrame(SWITCH_FRAME_TIMEOUT_MS)
    }
    ready().then(() => {
      if (request === this.showRequest && !this.disposed) this.reveal(tab)
    })
  }

  /** Makes `tab`'s view the only one on screen. */
  private reveal(tab: Tab): void {
    if (this.window.isDestroyed()) return
    const content = this.window.contentView
    content.addChildView(tab.view)
    for (const other of this.tabs) {
      if (other !== tab && content.children.includes(other.view))
        content.removeChildView(other.view)
    }
    for (const closed of this.retiring) {
      content.removeChildView(closed.view)
      closed.destroy()
    }
    this.retiring.clear()
    this.shownTab = tab
    this.updateVeil(false)
  }

  /** Veils the tab on screen while its new document hasn't drawn; `fade`: animate the change. */
  private updateVeil(fade: boolean): void {
    const tab = this.activeTab
    if (this.disposed || this.window.isDestroyed() || tab !== this.shownTab) return
    const color = tab.coverColor
    if (tab.isPainted || !color) this.veil.uncover(fade ? VEIL_FADE_OUT_MS : 0)
    else this.veil.cover(tab.bounds, tab.cornerRadius, color, fade ? VEIL_FADE_IN_MS : 0)
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
    if (!webContents) tab.loadOpened(details)
    if (!background) this.activate(tab.id)
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
    if (tab === this.shownTab && byUser && !this.window.isDestroyed()) {
      // Stays on screen, silent, until the tab after it has drawn (see show).
      tab.webContents.setAudioMuted(true)
      this.retiring.add(tab)
    } else {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view)
      if (tab === this.shownTab) this.shownTab = null
      tab.destroy()
    }

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
