/** One entry in the tab strip. */
export interface TabSummary {
  id: number
  url: string
  title: string
  /** A data: URL (fetched and checked by main), or null to show the default icon. */
  favicon: string | null
  isLoading: boolean
  isAudible: boolean
  isMuted: boolean
}

/** The find bar of a tab. */
export interface FindState {
  query: string
  /** 1-based; 0 when there's no match (yet). */
  activeMatch: number
  matches: number
}

/** Details the toolbar needs about the active tab. */
export interface ActiveTabState {
  id: number
  /** On an error page, the URL that failed. */
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  isErrorPage: boolean
  /** 1 is 100%. Per site: every tab on the same host shares it. */
  zoomFactor: number
  /** Null while the find bar is closed. */
  find: FindState | null
  /** Whether the tab's URL is bookmarked (the star in the address bar). */
  isBookmarked: boolean
  /** The ad blocker's shield in the address bar; null on pages that aren't on the web. */
  shield: ShieldState | null
}

/**
 * The ad blocker on the active tab's page:
 * - on: blocking; paused: the user paused it on this site; off: turned off everywhere
 * - loading: the filter lists are being downloaded for the first time
 * - unavailable: they couldn't be downloaded (offline); it tries again later
 */
export type ShieldStatus = 'on' | 'paused' | 'off' | 'loading' | 'unavailable'

export interface ShieldState {
  status: ShieldStatus
  /** The site blocking can be paused on: the page's hostname without "www.". */
  site: string
  /** Ads and trackers blocked on the current page (since it started loading). */
  blocked: number
}

/** One bookmark, saved in bookmarks.json. Only http(s) URLs can be bookmarked. */
export interface Bookmark {
  id: number
  url: string
  title: string
  /** A small data: URL, or null to show the default icon. */
  favicon: string | null
}

/** Where a bookmark opens: in the active tab, or a new tab in front or behind. */
export type OpenDisposition = 'current' | 'foreground' | 'background'

/**
 * - progressing, paused: running (paused by the user)
 * - interrupted: stopped by a network error; it can be resumed
 * - completed, cancelled, failed: finished
 */
export type DownloadStatus =
  'progressing' | 'paused' | 'interrupted' | 'completed' | 'cancelled' | 'failed'

/** One entry in the downloads list. */
export interface DownloadSummary {
  id: number
  /** The name it's saved under in the Downloads folder. */
  filename: string
  status: DownloadStatus
  receivedBytes: number
  /** 0 when the server didn't say. */
  totalBytes: number
}

/** Everything the UI shows, pushed from main at most once per tick whenever it changes. */
export interface BrowserState {
  tabs: TabSummary[]
  active: ActiveTabState
  /** Newest first. Empty until something is downloaded, and again after "Clear list". */
  downloads: DownloadSummary[]
  /** In bookmarks-bar order. */
  bookmarks: Bookmark[]
  /** The bar is only shown while there are bookmarks to put on it. */
  bookmarksBarVisible: boolean
}

/** The only surface the UI renderer has into the main process (window.browser). */
export interface BrowserApi {
  /** process.platform of the main process, e.g. "darwin" or "win32". */
  platform: string
  // These act on the active tab.
  navigate(input: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  stop(): Promise<void>
  home(): Promise<void>

  newTab(): Promise<void>
  closeTab(id: number): Promise<void>
  activateTab(id: number): Promise<void>
  reopenClosedTab(): Promise<void>
  toggleMute(id: number): Promise<void>
  /** Back to 100% for the active tab's site. */
  resetZoom(): Promise<void>

  // The active tab's find bar.
  /** Starts a new search as the user types; an empty query clears the highlights. */
  find(query: string): Promise<void>
  findNext(forward: boolean): Promise<void>
  closeFind(): Promise<void>
  /** Opens the downloads menu with its top-left corner at (x, y) in the window. */
  showDownloadsMenu(x: number, y: number): Promise<void>

  /** The star: bookmarks the active tab's page, or removes its bookmark. */
  toggleBookmark(): Promise<void>
  openBookmark(id: number, disposition: OpenDisposition): Promise<void>
  /** Right-click on a bookmark (or on the bar, with null): a native menu at (x, y). */
  showBookmarkMenu(id: number | null, x: number, y: number): Promise<void>
  /** The "»" menu: every bookmark from index `from` on, the ones that don't fit on the bar. */
  showBookmarksOverflow(from: number, x: number, y: number): Promise<void>
  /** The shield: the ad blocker's menu for the active tab, at (x, y). */
  showAdblockMenu(x: number, y: number): Promise<void>

  /** The UI's height in px; main places tabs directly below it. */
  setChromeHeight(px: number): Promise<void>

  getState(): Promise<BrowserState>
  /** Returns an unsubscribe function. */
  onState(callback: (state: BrowserState) => void): () => void
  /** Fired when Cmd/Ctrl+L is pressed anywhere in the window. */
  onFocusAddressBar(callback: () => void): () => void
  /** Fired when Cmd/Ctrl+F is pressed anywhere in the window. */
  onFocusFind(callback: () => void): () => void
}

/** IPC channel names, shared so main and preload can't drift apart. */
export const IpcChannel = {
  Navigate: 'tab:navigate',
  Back: 'tab:back',
  Forward: 'tab:forward',
  Reload: 'tab:reload',
  Stop: 'tab:stop',
  Home: 'tab:home',
  NewTab: 'tabs:new',
  CloseTab: 'tabs:close',
  ActivateTab: 'tabs:activate',
  ReopenClosedTab: 'tabs:reopen',
  ToggleMute: 'tabs:toggle-mute',
  ResetZoom: 'tab:reset-zoom',
  Find: 'find:query',
  FindNext: 'find:next',
  CloseFind: 'find:close',
  ShowDownloadsMenu: 'downloads:show-menu',
  ToggleBookmark: 'bookmarks:toggle-current',
  OpenBookmark: 'bookmarks:open',
  ShowBookmarkMenu: 'bookmarks:show-menu',
  ShowBookmarksOverflow: 'bookmarks:show-overflow',
  ShowAdblockMenu: 'adblock:show-menu',
  SetChromeHeight: 'ui:set-chrome-height',
  GetState: 'browser:get-state',
  State: 'browser:state',
  FocusAddressBar: 'ui:focus-address-bar',
  FocusFind: 'ui:focus-find'
} as const
