/*
 * The overlay view's contract (its preload, main, its renderer). The overlay is a transparent
 * WebContentsView laid over the page while a popover is open: the agent sheet, the errors
 * popover, a question for the user (a permission, opening another app, an agent's request), or a
 * menu (the shield, downloads, bookmarks, right-click).
 * Web pages draw above the UI's own webContents, so anything that hangs over a page needs a view
 * of its own. Kept apart from types.ts on purpose: preloads must not import the same module (see
 * terminal-view.ts). Type-only imports are fine, they leave nothing behind.
 */

/** Which surface the overlay shows. */
export type OverlayKind = 'agent' | 'errors' | 'prompt' | 'menu'

/** The bridge, as the sheet's header says it. */
export type BridgeStatus = 'off' | 'starting' | 'listening' | 'error'

/** The agent sheet ("Connect an agent"): the bridge, the active tab, how to connect, the token. */
export interface AgentSheet {
  status: BridgeStatus
  /** Why the bridge couldn't start. */
  error: string | null
  shareAll: boolean
  tab: {
    title: string
    /** As the address bar shows it (no scheme for the web, browminal://home for the start page). */
    url: string
    favicon: string | null
    shared: boolean
    /** A Browminal page (start page, error page): agents can open pages from it but not read it. */
    internal: boolean
  }
  /** An agent is acting on a tab right now: which one. */
  working: { title: string; here: boolean } | null
  /** What to copy to connect a client, the token masked; null until the bridge listens. */
  connect: { command: string; config: string } | null
  /** "Ctrl+Shift+X", or "⌘⇧X" on macOS. */
  pickShortcut: string
}

/** One of the page's new errors in the errors popover. */
export interface ErrorRow {
  /** The first line of the message. */
  message: string
  /** "cart.ts:48" (the original file when a source map says), or null. */
  place: string | null
  /** Times it was logged in a row. */
  count: number
}

/** The errors popover: the active tab's new errors, and what became of sending them. */
export interface ErrorsPopover {
  title: string
  count: number
  /** The newest few. */
  rows: ErrorRow[]
  /** Sent: where they went (the popover closes a moment later). */
  sent: { typed: boolean; pick: number | null; error: string | null } | null
}

/** What a prompt is about: picks its icon. */
export type PromptIcon =
  'camera' | 'microphone' | 'location' | 'notifications' | 'clipboard' | 'link' | 'agent'

/** A question for the user, anchored to the address bar: Allow/Block, Open/Cancel… */
export interface PromptView {
  id: number
  icon: PromptIcon
  /** Who asks, set in bold: "localhost:3000". Empty for none. */
  site: string
  /** What they want, after the site: "wants to use your camera". */
  message: string
  detail: string | null
  /** A URL or similar, shown in a code box. */
  code: string | null
  /** An agent asks (not the page): the "Agent request" mark. */
  fromAgent: boolean
  confirm: string
  cancel: string
  /** The confirm button deletes something: drawn in the danger colour. */
  destructive: boolean
}

/** A row of a menu. */
export type MenuRow =
  | { kind: 'separator' }
  | {
      kind: 'item'
      /** What the overlay sends back when it's chosen. */
      id: number
      label: string
      enabled: boolean
      /** A checkbox row: whether it's ticked; null for a plain row. */
      checked: boolean | null
      /** A checked data:image URL (a bookmark's favicon), or null. */
      icon: string | null
      /** "Ctrl+Shift+B": only shown, the shortcut works elsewhere. */
      shortcut: string | null
      /** Rows that open in place of the menu (with a way back). */
      submenu: MenuRow[] | null
    }

/** A menu over the window, drawn by the overlay; main runs what's chosen. */
export interface MenuView {
  /** New for every menu shown. */
  id: number
  rows: MenuRow[]
  /** Taller than this, it scrolls. */
  maxHeight: number
}

export type OverlayContent =
  | { kind: 'agent'; sheet: AgentSheet }
  | { kind: 'errors'; errors: ErrorsPopover }
  | { kind: 'prompt'; prompt: PromptView }
  | { kind: 'menu'; menu: MenuView }

/** Everything the overlay renderer draws, pushed by main. */
export interface OverlayState {
  content: OverlayContent | null
  /** The surface's width; its height is the content's (reported back), up to `maxHeight`. */
  width: number
  /** The tallest the surface may be before its content scrolls (the agent sheet); null: no cap. */
  maxHeight: number | null
  /** Where the surface sits inside the view (the rest is room for its shadow). */
  inset: { top: number; left: number }
}

/**
 * One layer of a surface's frosted backdrop: a small capture of a view under it (the UI, the
 * page, the terminal), shown blurred. Placed in px relative to the surface's top-left corner.
 */
export interface BackdropLayer {
  /** A data:image/png URL. */
  src: string
  x: number
  y: number
  width: number
  height: number
}

/** What the overlay renderer can do: window.overlay. One function per action. */
export interface OverlayApi {
  platform: string
  /** Listeners are set: main sends the state. */
  ready(): void
  /** The surface's height in px, so main can size the view to fit. */
  setHeight(px: number): void
  /** Esc, ✕, a click beside the surface. */
  close(): void
  onState(callback: (state: OverlayState) => void): () => void
  /** What lies under the surface, for its frosted backdrop; empty for none (plain surface). */
  onBackdrop(callback: (layers: BackdropLayer[]) => void): () => void

  // The agent sheet (they act on the active tab).
  setAgentsEnabled(enabled: boolean): void
  setTabShared(shared: boolean): void
  setShareAll(shareAll: boolean): void
  pickElement(): void
  /** Copies the command or the JSON with the real token (the renderer never sees it). */
  copyConnect(what: 'command' | 'config'): void
  renewToken(): void
  retryBridge(): void
  stopAgent(): void

  // The errors popover.
  sendErrors(): void
  dismissErrors(): void

  // A prompt.
  answer(id: number, confirmed: boolean): void

  // A menu: the row chosen, and whether Ctrl/Cmd or Shift was held.
  choose(id: number, ctrl: boolean, shift: boolean): void
}

/** IPC between the overlay view and main; only the overlay view may use these. */
export const OverlayChannel = {
  Ready: 'overlay:ready',
  SetHeight: 'overlay:set-height',
  Close: 'overlay:close',
  State: 'overlay:state',
  Backdrop: 'overlay:backdrop',
  SetAgentsEnabled: 'overlay:set-agents-enabled',
  SetTabShared: 'overlay:set-tab-shared',
  SetShareAll: 'overlay:set-share-all',
  PickElement: 'overlay:pick-element',
  CopyConnect: 'overlay:copy-connect',
  RenewToken: 'overlay:renew-token',
  RetryBridge: 'overlay:retry-bridge',
  StopAgent: 'overlay:stop-agent',
  SendErrors: 'overlay:send-errors',
  DismissErrors: 'overlay:dismiss-errors',
  Answer: 'overlay:answer',
  Choose: 'overlay:choose'
} as const

/** Widths of the surfaces, and the room around them for the shadow. */
export const SHEET_WIDTH = 360
export const ERRORS_WIDTH = 380
export const PROMPT_WIDTH = 360
/** A menu's width when its maker doesn't say. */
export const MENU_WIDTH = 248
/** Popovers hang this far below what opened them. */
export const POPOVER_GAP = 6
export const SHADOW_ROOM = { top: 2, side: 20, bottom: 30 } as const
/** setHeight rejects anything taller. */
export const MAX_OVERLAY_HEIGHT = 4000
