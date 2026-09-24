/** Snapshot of a tab, pushed from main to the UI whenever it changes. */
export interface TabState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

/** The only surface the UI renderer has into the main process (window.browser). */
export interface BrowserApi {
  /** process.platform of the main process, e.g. "darwin" or "win32". */
  platform: string
  navigate(input: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  stop(): Promise<void>
  getState(): Promise<TabState>
  /** Returns an unsubscribe function. */
  onTabState(callback: (state: TabState) => void): () => void
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
  GetState: 'tab:get-state',
  TabState: 'tab:state',
  FocusAddressBar: 'ui:focus-address-bar'
} as const
