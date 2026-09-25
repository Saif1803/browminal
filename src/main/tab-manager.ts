import type { BrowserWindow, WebContents } from 'electron'
import { INITIAL_CHROME_HEIGHT } from '../shared/layout'
import type { BrowserState } from '../shared/types'
import { HOME_URL, isHomeUrl } from '../shared/url'
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
  private stateListener: ((state: BrowserState) => void) | null = null
  private createdListeners: ((tab: Tab) => void)[] = []
  private updateScheduled = false
  private disposed = false

  private readonly hooks: TabHooks = {
    changed: () => this.scheduleUpdate(),
    opened: (opener, request) => this.openFromPage(opener, request),
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

  /** Receives the full state, at most once per tick. */
  onStateChange(listener: (state: BrowserState) => void): void {
    this.stateListener = listener
  }

  /** Called for every tab, including ones that already exist. */
  onTabCreated(listener: (tab: Tab) => void): void {
    this.createdListeners.push(listener)
    this.tabs.forEach(listener)
  }

  getState(): BrowserState {
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
    if (previous !== tab) {
      if (previous) this.window.contentView.removeChildView(previous.view)
      this.window.contentView.addChildView(tab.view)
    }
    this.layout()
    tab.webContents.focus()
    this.scheduleUpdate()
  }

  /** Ctrl+Shift+T: reopens the most recently closed tab where it was. */
  reopenClosed(): void {
    const entry = this.closed.pop()
    if (entry) this.create({ url: entry.url, index: Math.min(entry.index, this.tabs.length) })
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
    const bounds = {
      x: 0,
      y: this.chromeHeight,
      width,
      height: Math.max(0, height - this.chromeHeight)
    }
    // Background tabs get sized too, so pages loading there lay out at the right width.
    for (const tab of this.tabs) tab.setBounds(bounds)
  }

  /** Destroys every tab. Call when the window closes. */
  dispose(): void {
    this.disposed = true
    this.stateListener = null
    for (const tab of this.tabs) tab.destroy()
    this.tabs = []
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
    this.scheduleUpdate()
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
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view)
    tab.destroy()

    if (nextActiveId === null) {
      // Closing the last tab leaves a fresh home tab, not an empty window.
      this.create()
    } else if (nextActiveId !== this.activeTab.id) {
      this.activate(nextActiveId)
    }
    this.scheduleUpdate()
  }

  private scheduleUpdate(): void {
    if (this.updateScheduled || this.disposed) return
    this.updateScheduled = true
    setImmediate(() => {
      this.updateScheduled = false
      if (!this.disposed) this.stateListener?.(this.getState())
    })
  }
}

/** Only pages main would load itself are remembered; never error pages, data: or blank ones. */
const isReopenable = (url: string): boolean => /^https?:\/\//i.test(url) || isHomeUrl(url)

let lastId = 0
const nextId = (): number => ++lastId
