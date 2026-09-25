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
}

/** Everything the UI shows, pushed from main at most once per tick whenever it changes. */
export interface BrowserState {
  tabs: TabSummary[]
  active: ActiveTabState
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
  SetChromeHeight: 'ui:set-chrome-height',
  GetState: 'browser:get-state',
  State: 'browser:state',
  FocusAddressBar: 'ui:focus-address-bar',
  FocusFind: 'ui:focus-find'
} as const
