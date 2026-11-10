import type { PanelDock } from './layout'
import type { AgentBrand } from './agents'
import type { OverlayKind } from './overlay'

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
  /** Agents may see and act on this tab (see AgentState). */
  agentShared: boolean
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
  /** What an agent is emulating on this tab ("iPhone 15 · dark · offline"), or null. */
  emulation: string | null
  /** New errors on a shared tab's page (uncaught or console.error) not yet sent or read; 0 if none. */
  errors: number
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

/** The agent bridge: the local MCP server terminal agents (Claude Code…) connect to. */
export interface AgentState {
  /** Switched on by the user; off by default. */
  enabled: boolean
  /** Where it listens on 127.0.0.1; null while it is off, starting, or couldn't start. */
  port: number | null
  /** Why it couldn't start. */
  error: string | null
  /** Every tab is shared, not only the ones the user shared. */
  shareAll: boolean
  /** The tab an agent is acting on right now (and for a moment after), or null. */
  working: number | null
  /** The tab the user is picking an element on for agents (Ctrl+Shift+X), or null. */
  picking: number | null
  /** What became of the user's last pick, for a few seconds after it; null otherwise. */
  pick: PickNotice | null
}

/** A pick the user just made (an element, or a page's errors) and where it went. */
export interface PickNotice {
  /** Its number, which agents read it by (get_picks); null when it failed. */
  id: number | null
  kind: 'element' | 'errors'
  /** It was typed into the prompt of the agent running in a Browminal terminal on that tab. */
  typed: boolean
  /** Why it failed, or null. */
  error: string | null
}

/** One shell in the terminal panel. */
export interface TerminalSession {
  id: number
  /** The shell's or agent's name ("PowerShell", "Claude", "Codex"), numbered when there are several. */
  title: string
  /** The browser tab this terminal works on (its agent's tab); null once that tab closed. */
  tabId: number | null
  /** The name of the folder the shell started in (never its path). */
  folder: string
  /** The shell has exited; the session stays until it's closed or restarted. */
  exited: boolean
  /** Its exit code once it has exited (null while it runs, or if the OS didn't say). */
  exitCode: number | null
  /** It runs an agent (claude, codex, any other), started from the start page. */
  agent: boolean
  /** That agent is Claude Code or Codex (drawn with its own mark); null for any other. */
  brand: AgentBrand | null
}

/** An agent command (the start page's field) is at most this long. */
export const MAX_AGENT_COMMAND = 200
/** In an agent command, replaced by the path of the MCP config file Browminal wrote for it. */
export const MCP_CONFIG_PLACEHOLDER = '{mcp-config}'

/** The terminal panel under the page or beside it, like an IDE's. */
export interface TerminalPanelState {
  open: boolean
  /** Where it sits; each dock keeps its own size. */
  dock: PanelDock
  /** Height in px at the bottom, the header included (see windowLayout). */
  height: number
  /** Width in px on the right. */
  width: number
  sessions: TerminalSession[]
  /** The session shown; null: the start page (a folder and an agent to start a session with). */
  activeId: number | null
  /** The name (never the path) of the project folder chosen for the active tab's site, or null. */
  folder: string | null
  /** The active tab's site that folder is remembered for ("http://localhost:5173"), or null. */
  site: string | null
  /** Agent commands the start page offers: the ones used before (last first), then claude, codex. */
  agentCommands: string[]
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
  agent: AgentState
  terminal: TerminalPanelState
  /** What hangs over the page (main's overlay view), so its button can look pressed. */
  overlay: OverlayKind | null
}

/** Command-line switch main gives the UI renderer when the window has a glass background. */
export const GLASS_SWITCH = '--browminal-glass'

/** The only surface the UI renderer has into the main process (window.browser). */
export interface BrowserApi {
  /** process.platform of the main process, e.g. "darwin" or "win32". */
  platform: string
  /** The window has a see-through (acrylic / vibrancy) background: the UI paints translucent. */
  glass: boolean
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
  /** The agent button: opens the agent sheet over the page (or closes it). */
  toggleAgentSheet(): Promise<void>
  /** "Stop" while an agent works on tab `id`: it stops being shared. */
  stopAgent(id: number): Promise<void>
  /** The emulation badge: tab `id` goes back to its own size, colours and network. */
  resetEmulation(id: number): Promise<void>
  /** Stops picking an element (Esc does too). */
  cancelPick(): Promise<void>
  /**
   * The errors badge: the popover with the active tab's new errors (send them to the agent, or
   * dismiss them), its top-right corner at (x, y). Or closes it.
   */
  toggleErrors(x: number, y: number): Promise<void>
  /** Where questions for the user hang from: the address bar's leading icon, (x, y) its bottom-left. */
  setPromptAnchor(x: number, y: number): Promise<void>

  // The terminal panel.
  /** Ctrl+`: opens the panel (the start page if no session runs), or closes it. */
  toggleTerminal(): Promise<void>
  /** A new plain terminal working on the active tab. */
  newTerminal(): Promise<void>
  closeTerminal(id: number): Promise<void>
  /** Starts an exited terminal's shell (or agent) again, in the same folder, on the same tab. */
  restartTerminal(id: number): Promise<void>
  /** The panel's agent button: shows the start page. */
  showTerminalStartPage(): Promise<void>
  /**
   * "Start session": a new terminal for the active tab running only the agent `command` (claude,
   * codex, any other), connected to Browminal, in the folder chosen for its site (asked for first
   * if there is none).
   */
  startAgentSession(command: string): Promise<void>
  selectTerminal(id: number): Promise<void>
  /** Resizing the panel (its height at the bottom, its width on the right); main clamps it. */
  setTerminalSize(px: number): Promise<void>
  /** Moves the panel under the page or to its right. */
  setTerminalDock(dock: PanelDock): Promise<void>
  /** Points terminal `id` (and its agent) at the active tab. */
  attachTerminal(id: number): Promise<void>
  /** Asks for the project folder agents work in and remembers it for the active tab's site. */
  chooseTerminalFolder(): Promise<void>

  /** The UI's height in px; main places tabs directly below it. */
  setChromeHeight(px: number): Promise<void>

  getState(): Promise<BrowserState>
  /** Returns an unsubscribe function. */
  onState(callback: (state: BrowserState) => void): () => void
  /**
   * Cmd/Ctrl+L, or a new tab was opened: focus the address bar of tab `tabId`. The state that
   * makes it the active tab may arrive after this.
   */
  onFocusAddressBar(callback: (tabId: number) => void): () => void
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
  ToggleAgentSheet: 'agent:toggle-sheet',
  StopAgent: 'agent:stop',
  ResetEmulation: 'agent:reset-emulation',
  CancelPick: 'agent:cancel-pick',
  ToggleErrors: 'agent:toggle-errors',
  SetPromptAnchor: 'ui:set-prompt-anchor',
  SetChromeHeight: 'ui:set-chrome-height',
  ToggleTerminal: 'terminal:toggle',
  NewTerminal: 'terminal:new',
  CloseTerminal: 'terminal:close',
  RestartTerminal: 'terminal:restart',
  ShowTerminalStartPage: 'terminal:start-page',
  StartAgentSession: 'terminal:start-agent',
  SelectTerminal: 'terminal:select',
  SetTerminalSize: 'terminal:set-size',
  SetTerminalDock: 'terminal:set-dock',
  AttachTerminal: 'terminal:attach',
  ChooseTerminalFolder: 'terminal:choose-folder',
  GetState: 'browser:get-state',
  State: 'browser:state',
  FocusAddressBar: 'ui:focus-address-bar',
  FocusFind: 'ui:focus-find'
} as const
