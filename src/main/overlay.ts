import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'
import { copyText } from './copy-text'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { Rect } from '../shared/layout'
import {
  ERRORS_WIDTH,
  MAX_OVERLAY_HEIGHT,
  MENU_WIDTH,
  OverlayChannel,
  POPOVER_GAP,
  PROMPT_WIDTH,
  SHEET_WIDTH,
  type BackdropLayer,
  type ErrorRow,
  type ErrorsPopover,
  type OverlayContent,
  type OverlayKind,
  type OverlayState,
  type MenuRow,
  type PromptView
} from '../shared/overlay'
import type { Agent } from './agent'
import { canInspect, claudeAddCommand, mcpConfigJson } from './agent-policy'
import {
  backdropRegions,
  bridgeStatus,
  connectTexts,
  menuMaxHeight,
  overlayBounds,
  pointerMenuRect,
  popoverRect,
  sheetRect,
  sheetUrl
} from './overlay-content'
import { menuRows, type MenuAction, type MenuEntry, type MenuModifiers } from './menu-model'
import type { TabManager } from './tab-manager'

// A click on the button that opened a popover first blurs it closed: within this long, that
// click only closes it (it doesn't open it again).
const REOPEN_GUARD_MS = 300
// "Sent to your agent" stays this long before the errors popover closes.
const SENT_NOTICE_MS = 2600
// Before the surface reports its height, the view is this tall (it's clear, so nothing shows).
const FIRST_HEIGHT = 240
// The frosted backdrop: captured once the surface has settled, then again now and then, since
// what's under it changes. Captures are shown blurred, so a quarter of their size is plenty.
const BACKDROP_DELAY_MS = 40
const BACKDROP_REFRESH_MS = 1000
const BACKDROP_SCALE = 0.25

interface Anchor {
  x: number
  y: number
  align: 'left' | 'right'
}

/** A question waiting for the user. */
interface Question {
  view: PromptView
  /** The tab it's about: it goes away (unanswered) when that tab isn't in front any more. */
  tabId: number | null
  resolve: (answer: boolean | null) => void
}

interface OpenMenu {
  kind: 'menu'
  id: number
  rows: MenuRow[]
  actions: Map<number, MenuAction>
  at: 'pointer' | 'anchor'
  point: { x: number; y: number }
  width: number
  /** Gets the keyboard back when the menu closes (the UI, or the page it was opened on). */
  returnTo: WebContents
  /** A button's menu: a click on it while open closes the menu. */
  toggle: string | null
}

type Open =
  | { kind: 'agent' }
  | { kind: 'errors'; tabId: number; anchor: Anchor; sent: ErrorsPopover['sent'] }
  | { kind: 'prompt' }
  | OpenMenu

/** How a menu is opened. */
export interface MenuOptions {
  /** 'pointer': at (x, y), flipping to fit (right-click); 'anchor': hanging from (x, y). */
  at: 'pointer' | 'anchor'
  width?: number
  returnTo: WebContents
  /** For a button's menu: its name, so a second click on it closes the menu. */
  toggle?: string
}

export type PromptRequest = Omit<PromptView, 'id'>

/** The overlay view's page: served by the dev server, or the built file. */
function loadPage(view: WebContentsView): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) view.webContents.loadURL(`${devUrl}/overlay.html`)
  else view.webContents.loadFile(join(__dirname, '../renderer/overlay.html'))
}

/**
 * The popovers that hang over the page: the agent sheet, the errors popover and questions for
 * the user (permissions, opening another app, an agent's request). One transparent, sandboxed
 * view of our own with a preload of a few named functions, attached only while something is
 * open, sized to it and kept on top of the page, the veil and the terminal.
 *
 * Popovers close on Esc, ✕, or when the keyboard goes elsewhere (a click on the page or the
 * toolbar). Questions stay until answered; one shows at a time, the others wait their turn.
 */
export class Overlay {
  readonly view: WebContentsView
  private open: Open | null = null
  private questions: Question[] = []
  private height = FIRST_HEIGHT
  private surface: Rect | null = null
  private viewReady = false
  private attached = false
  private disposed = false
  /** What closed a moment ago ('agent', 'errors', or 'menu:<toggle>'), for toggleOff. */
  private lastClosed: { key: string; at: number } | null = null
  private nextMenuId = 1
  private promptAnchor = { x: 150, y: 80 }
  private errorRows: { tabId: number; count: number; rows: ErrorRow[] } | null = null
  private sentTimer: NodeJS.Timeout | null = null
  private backdropTimer: NodeJS.Timeout | null = null
  /** Bumped whenever captures under way go stale (the surface moved or closed). */
  private backdropRound = 0
  private lastState = ''
  private nextQuestionId = 1
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly window: BrowserWindow,
    private readonly tabs: TabManager,
    private readonly agent: Agent
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/overlay.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.view.setBackgroundColor('#00000000')
    const wc = this.view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (event) => event.preventDefault())
    wc.on('will-attach-webview', (event) => event.preventDefault())
    wc.on('did-start-loading', () => (this.viewReady = false))
    // Light dismiss: the keyboard went to the page, the toolbar or another app.
    wc.on('blur', () => {
      if (this.open && this.open.kind !== 'prompt') this.close(true)
    })
    loadPage(this.view)

    tabs.onLayout(() => this.place())
    tabs.onRestack(() => this.raise())
  }

  /** Called whenever what's open changes (the UI marks the button that opened it). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** What's open, for the UI. */
  get kind(): OverlayKind | null {
    return this.open?.kind ?? null
  }

  /** The agent button: opens the sheet, or closes it. */
  toggleAgentSheet(): void {
    if (this.toggleOff('agent')) return
    this.show({ kind: 'agent' })
  }

  /**
   * A menu at (x, y) in window coordinates. Esc, a click elsewhere or choosing a row closes it,
   * and the keyboard goes back to `returnTo`. Not while a question is up.
   */
  showMenu(entries: MenuEntry[], x: number, y: number, options: MenuOptions): void {
    const toggle = options.toggle ?? null
    if (toggle !== null && this.toggleOff(`menu:${toggle}`)) return
    const { rows, actions } = menuRows(entries)
    if (rows.length === 0) return
    this.show({
      kind: 'menu',
      id: this.nextMenuId++,
      rows,
      actions,
      at: options.at,
      point: { x: Math.round(x), y: Math.round(y) },
      width: options.width ?? MENU_WIDTH,
      returnTo: options.returnTo,
      toggle
    })
  }

  /** A menu row was chosen: the menu closes, then the row's action runs. */
  choose(id: number, modifiers: MenuModifiers): void {
    if (this.open?.kind !== 'menu') return
    const action = this.open.actions.get(id)
    if (!action) return
    this.hide(true)
    action(modifiers)
  }

  /** The errors badge: the active tab's new errors, hanging from (x, y) by its right edge. */
  toggleErrors(x: number, y: number): void {
    if (this.toggleOff('errors')) return
    const tabId = this.tabs.active.id
    if (this.agent.errorsOf(tabId) === 0) return
    this.show({
      kind: 'errors',
      tabId,
      anchor: { x, y: y + POPOVER_GAP, align: 'right' },
      sent: null
    })
    void this.loadErrorRows(tabId)
  }

  /** Where questions hang from: under the address bar's leading icon (the UI reports it). */
  setPromptAnchor(x: number, y: number): void {
    this.promptAnchor = { x, y }
    if (this.open?.kind === 'prompt') this.place()
  }

  /**
   * Asks the user: true for the confirm button, false for cancel (or Esc), null when the
   * question went away unanswered (its tab left the front, closed, or the window closed).
   */
  ask(request: PromptRequest, tabId: number | null): Promise<boolean | null> {
    if (this.disposed || this.window.isDestroyed()) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.questions.push({ view: { ...request, id: this.nextQuestionId++ }, tabId, resolve })
      if (this.questions.length === 1) this.show({ kind: 'prompt' })
    })
  }

  /** Closes whatever is open (Esc, ✕). An open question counts as answered with cancel. */
  close(blurred = false): void {
    if (!this.open) return
    if (this.open.kind === 'prompt') {
      const question = this.questions[0]
      if (question) this.answer(question.view.id, false)
      return
    }
    this.lastClosed = { key: openKey(this.open), at: Date.now() }
    this.hide(!blurred)
  }

  /** The prompt's buttons. */
  answer(id: number, confirmed: boolean): void {
    this.settle(id, confirmed)
  }

  /** The window changed size: a popover or menu hanging from the toolbar would hang from nothing. */
  windowResized(): void {
    if (this.open?.kind === 'errors' || this.open?.kind === 'menu') this.hide(false)
  }

  /** Something the overlay shows changed (agent, tabs): redraw it, or close what's stale. */
  refresh(): void {
    if (!this.open || this.disposed) return
    const question = this.questions[0]
    if (question && question.tabId !== null && this.tabs.active.id !== question.tabId) {
      this.settle(question.view.id, null)
      return
    }
    if (this.open.kind === 'errors') {
      const { tabId, sent } = this.open
      if (this.tabs.active.id !== tabId || (!sent && this.agent.errorsOf(tabId) === 0)) {
        this.hide(false)
        return
      }
      if (!sent && this.errorRows?.count !== this.agent.errorsOf(tabId))
        void this.loadErrorRows(tabId)
    }
    this.push()
  }

  // The sheet's and the popover's actions (from the overlay view, checked in ipc.ts).

  setTabShared(shared: boolean): void {
    const id = this.tabs.active.id
    if (this.agent.isShared(id) !== shared) this.agent.toggleShared(id)
  }

  pickElement(): void {
    const id = this.tabs.active.id
    this.hide(true)
    void this.agent.togglePicking(id)
  }

  copyConnect(what: 'command' | 'config'): void {
    const port = this.agent.port
    if (port === null) return
    const token = this.agent.token
    copyText(what === 'command' ? claudeAddCommand(port, token) : mcpConfigJson(port, token))
  }

  stopAgent(): void {
    const working = this.agent.getState().working
    if (working !== null) this.agent.stop(working)
  }

  async sendErrors(): Promise<void> {
    const open = this.open
    if (open?.kind !== 'errors' || open.sent) return
    const notice = await this.agent.sendErrors(open.tabId)
    if (this.open !== open) return
    open.sent = notice
      ? { typed: notice.typed, pick: notice.id, error: notice.error }
      : { typed: false, pick: null, error: 'There were no errors left to send' }
    this.push()
    if (this.sentTimer) clearTimeout(this.sentTimer)
    this.sentTimer = setTimeout(() => {
      this.sentTimer = null
      if (this.open === open) this.hide(true)
    }, SENT_NOTICE_MS)
  }

  dismissErrors(): void {
    if (this.open?.kind !== 'errors') return
    this.agent.dismissErrors(this.open.tabId)
    this.hide(true)
  }

  // From the overlay renderer.

  viewLoaded(): void {
    this.viewReady = true
    this.lastState = ''
    this.push()
  }

  /** The surface's height, measured by the renderer. */
  setHeight(px: number): void {
    const height = Math.min(Math.max(0, Math.round(px)), MAX_OVERLAY_HEIGHT)
    if (height === this.height) return
    this.height = height
    this.place()
  }

  dispose(): void {
    this.disposed = true
    if (this.sentTimer) clearTimeout(this.sentTimer)
    this.stopBackdrop()
    for (const question of this.questions) question.resolve(null)
    this.questions = []
    this.listeners.clear()
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  /** True if `key` was open a moment ago, closed by the click that is now asking to open it. */
  private toggleOff(key: string): boolean {
    if (this.open && openKey(this.open) === key) {
      this.close()
      return true
    }
    const closed = this.lastClosed
    this.lastClosed = null
    return closed?.key === key && Date.now() - closed.at < REOPEN_GUARD_MS
  }

  private show(open: Open): void {
    if (this.disposed || this.window.isDestroyed()) return
    // A question stays up until it's answered.
    if (this.open?.kind === 'prompt' && open.kind !== 'prompt') return
    if (this.sentTimer) clearTimeout(this.sentTimer)
    this.sentTimer = null
    // Another menu (a second right-click) is a new surface too.
    const kindChanged = this.open?.kind !== open.kind || open.kind === 'menu'
    this.open = open
    if (kindChanged) {
      this.height = FIRST_HEIGHT
      this.clearBackdrop()
    }
    this.push()
    this.place()
    if (!this.view.webContents.isDestroyed()) this.view.webContents.focus()
    this.changed()
  }

  /** Takes the overlay off screen; `refocus`: the page gets the keyboard back. */
  private hide(refocus: boolean): void {
    if (!this.open) return
    const returnTo = this.open.kind === 'menu' ? this.open.returnTo : this.tabs.active.webContents
    this.open = null
    this.surface = null
    if (this.sentTimer) clearTimeout(this.sentTimer)
    this.sentTimer = null
    this.clearBackdrop()
    this.push()
    this.detach()
    if (refocus && !this.window.isDestroyed() && !returnTo.isDestroyed()) returnTo.focus()
    this.changed()
  }

  private settle(id: number, answer: boolean | null): void {
    const index = this.questions.findIndex((question) => question.view.id === id)
    if (index === -1) return
    const [question] = this.questions.splice(index, 1)
    question.resolve(answer)
    if (index !== 0) return
    // Questions about a tab that has left the front go away unanswered.
    while (this.questions[0]?.tabId != null && this.questions[0].tabId !== this.tabs.active.id) {
      this.questions.shift()?.resolve(null)
    }
    if (this.questions.length > 0) {
      this.height = FIRST_HEIGHT
      this.push()
      this.place()
    } else {
      this.hide(answer !== null)
    }
  }

  private async loadErrorRows(tabId: number): Promise<void> {
    const count = this.agent.errorsOf(tabId)
    const rows = await this.agent.errorRows(tabId)
    if (this.open?.kind !== 'errors' || this.open.tabId !== tabId) return
    this.errorRows = { tabId, count, rows }
    this.push()
  }

  /** Where the surface goes, from what's open and the window's layout. */
  private surfaceRect(): Rect | null {
    const open = this.open
    if (!open || this.window.isDestroyed()) return null
    const { width, height } = this.window.getContentBounds()
    if (open.kind === 'agent') return sheetRect(this.tabs.active.bounds, SHEET_WIDTH, this.height)
    if (open.kind === 'menu') {
      return open.at === 'pointer'
        ? pointerMenuRect(open.point, open.width, this.height, width, height)
        : popoverRect({ ...open.point, align: 'left' }, open.width, this.height, width, height)
    }
    const anchor: Anchor =
      open.kind === 'errors'
        ? open.anchor
        : { x: this.promptAnchor.x, y: this.promptAnchor.y + POPOVER_GAP, align: 'left' }
    const surfaceWidth = open.kind === 'errors' ? ERRORS_WIDTH : PROMPT_WIDTH
    return popoverRect(anchor, surfaceWidth, this.height, width, height)
  }

  private place(): void {
    if (!this.open || this.disposed || this.window.isDestroyed()) return
    const surface = this.surfaceRect()
    if (!surface || surface.width <= 0) return
    this.surface = surface
    const { width, height } = this.window.getContentBounds()
    const { bounds } = overlayBounds(surface, width, height)
    this.view.setBounds(bounds)
    this.push()
    this.scheduleBackdrop(BACKDROP_DELAY_MS)
    if (!this.attached) {
      this.window.contentView.addChildView(this.view)
      this.attached = true
    }
  }

  private scheduleBackdrop(delay: number): void {
    if (this.backdropTimer) clearTimeout(this.backdropTimer)
    this.backdropRound++
    this.backdropTimer = setTimeout(() => void this.captureBackdrop(), delay)
  }

  private stopBackdrop(): void {
    if (this.backdropTimer) clearTimeout(this.backdropTimer)
    this.backdropTimer = null
    this.backdropRound++
  }

  /** Stops capturing, and the surface goes back to plain (nothing stale shows next time). */
  private clearBackdrop(): void {
    this.stopBackdrop()
    this.sendBackdrop([])
  }

  /**
   * The frosted backdrop: what lies under the surface in the views below it (the UI, the page,
   * its veil, the terminal), captured small; the overlay shows it blurred. A view can't blur
   * another view's pixels, so this stands in for backdrop-filter.
   */
  private async captureBackdrop(): Promise<void> {
    this.backdropTimer = null
    const surface = this.surface
    if (!this.open || !surface || this.disposed || this.window.isDestroyed()) return
    const round = this.backdropRound
    if (this.window.isVisible() && !this.window.isMinimized()) {
      const { width, height } = this.window.getContentBounds()
      // Back to front: the UI (the window's own webContents), then the views attached over it.
      const views = [
        { contents: this.window.webContents, rect: { x: 0, y: 0, width, height } },
        ...this.window.contentView.children
          .filter((child): child is WebContentsView => child instanceof WebContentsView)
          .filter((child) => child !== this.view)
          .map((child) => ({ contents: child.webContents, rect: child.getBounds() }))
      ]
      const regions = backdropRegions(
        surface,
        views.map(({ rect }) => rect)
      )
      const layers = await Promise.all(
        regions.map(async (region): Promise<BackdropLayer | null> => {
          const { contents } = views[region.view]
          if (contents.isDestroyed()) return null
          try {
            const image = await contents.capturePage(region.capture)
            if (image.isEmpty()) return null
            const small = image.resize({
              width: Math.max(1, Math.round(region.capture.width * BACKDROP_SCALE)),
              quality: 'good'
            })
            return {
              src: small.toDataURL(),
              x: region.x,
              y: region.y,
              width: region.capture.width,
              height: region.capture.height
            }
          } catch {
            return null
          }
        })
      )
      if (round !== this.backdropRound || this.disposed) return
      this.sendBackdrop(layers.filter((layer): layer is BackdropLayer => layer !== null))
    }
    if (round === this.backdropRound && this.open) {
      this.backdropTimer = setTimeout(() => void this.captureBackdrop(), BACKDROP_REFRESH_MS)
    }
  }

  private sendBackdrop(layers: BackdropLayer[]): void {
    if (!this.viewReady || this.view.webContents.isDestroyed()) return
    this.view.webContents.send(OverlayChannel.Backdrop, layers)
  }

  /** Back on top after a tab, the veil or the terminal was added above it. */
  private raise(): void {
    if (!this.attached || this.window.isDestroyed()) return
    const content = this.window.contentView
    if (content.children.at(-1) !== this.view) content.addChildView(this.view)
  }

  private detach(): void {
    if (!this.attached) return
    this.attached = false
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view)
  }

  private content(): OverlayContent | null {
    const open = this.open
    if (!open) return null
    if (open.kind === 'prompt') {
      const question = this.questions[0]
      return question ? { kind: 'prompt', prompt: question.view } : null
    }
    if (open.kind === 'menu') {
      const windowHeight = this.window.getContentBounds().height
      return {
        kind: 'menu',
        menu: {
          id: open.id,
          rows: open.rows,
          maxHeight: menuMaxHeight(open.at, open.point.y, windowHeight)
        }
      }
    }
    if (open.kind === 'errors') {
      const tab = this.tabs.get(open.tabId)
      const rows = this.errorRows?.tabId === open.tabId ? this.errorRows.rows : []
      return {
        kind: 'errors',
        errors: {
          title: tab?.getSummary().title ?? '',
          count: open.sent ? (this.errorRows?.count ?? 0) : this.agent.errorsOf(open.tabId),
          rows,
          sent: open.sent
        }
      }
    }
    const tab = this.tabs.active
    const state = this.agent.getState()
    const summary = tab.getSummary()
    const working = state.working === null ? undefined : this.tabs.get(state.working)
    const port = this.agent.port
    return {
      kind: 'agent',
      sheet: {
        status: bridgeStatus(state),
        error: state.error,
        shareAll: state.shareAll,
        tab: {
          title: summary.title || 'Untitled',
          url: sheetUrl(summary.url),
          favicon: summary.favicon,
          shared: this.agent.isShared(tab.id),
          internal: !canInspect(tab.webContents.getURL())
        },
        working: working
          ? { title: working.getSummary().title || 'Untitled', here: working === tab }
          : null,
        connect: port === null ? null : connectTexts(port, this.agent.token),
        pickShortcut: process.platform === 'darwin' ? '⌘⇧X' : 'Ctrl+Shift+X'
      }
    }
  }

  private push(): void {
    if (this.disposed || !this.viewReady || this.window.isDestroyed()) return
    if (this.view.webContents?.isDestroyed() !== false) return
    const content = this.content()
    const surface = this.surface
    const { width, height } = this.window.getContentBounds()
    const inset = surface ? overlayBounds(surface, width, height).inset : { top: 0, left: 0 }
    const state: OverlayState = {
      content,
      width: surface?.width ?? this.fallbackWidth(),
      maxHeight:
        this.open?.kind === 'agent'
          ? sheetRect(this.tabs.active.bounds, SHEET_WIDTH, MAX_OVERLAY_HEIGHT).height
          : null,
      inset
    }
    // Agent and tab changes come often; send only what's new.
    const json = JSON.stringify(state)
    if (json === this.lastState) return
    this.lastState = json
    this.view.webContents.send(OverlayChannel.State, state)
  }

  /** The surface's width before it's placed. */
  private fallbackWidth(): number {
    if (this.open?.kind === 'menu') return this.open.width
    return this.open?.kind === 'errors' ? ERRORS_WIDTH : SHEET_WIDTH
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

/** What's open, as toggleOff compares it: a button's menu by its name. */
function openKey(open: Open): string {
  return open.kind === 'menu' ? `menu:${open.toggle ?? ''}` : open.kind
}
