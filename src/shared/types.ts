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

/** Details the toolbar needs about the active tab. */
export interface ActiveTabState {
  id: number
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
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
  /** The UI's height in px; main places tabs directly below it. */
  setChromeHeight(px: number): Promise<void>

  getState(): Promise<BrowserState>
  /** Returns an unsubscribe function. */
  onState(callback: (state: BrowserState) => void): () => void
  /** Fired when Cmd/Ctrl+L is pressed anywhere in the window. */
  onFocusAddressBar(callback: () => void): () => void
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
  SetChromeHeight: 'ui:set-chrome-height',
  GetState: 'browser:get-state',
  State: 'browser:state',
  FocusAddressBar: 'ui:focus-address-bar'
} as const
