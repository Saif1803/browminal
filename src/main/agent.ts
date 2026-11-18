import { app } from 'electron'
import { join } from 'path'
import type { ErrorRow } from '../shared/overlay'
import type { AgentState, PickNotice } from '../shared/types'
import { newAgentToken, parseAgentFile, toAgentFile, type AgentFile } from './agent-auth'
import { captureElementPick, captureErrorsPick } from './agent-picks'
import { canInspect, defaultAgentTab, type AgentTab } from './agent-policy'
import { startAgentServer, type AgentServer } from './agent-server'
import type { AgentQuestion } from './agent-tool-helpers'
import { createAgentMcp, type AgentContext } from './agent-tools'
import { positionsOf } from './console-log'
import { errorRows } from './overlay-content'
import type { Settings } from './settings'
import { PickList, pickPrompt, type NewPick } from './picks'
import { JsonStore } from './store'
import { TabDebug } from './tab-debug'
import type { Tab } from './tabs'
import type { MainWindow } from './window'

// After its last command an agent still counts as working this long, so the mark doesn't flicker.
const WORKING_LINGER_MS = 2000
// How long whenListening waits for the server to start.
const START_TIMEOUT_MS = 10_000
// How long a tool waits for its tab, just brought to the front, to be on screen (and then drawn).
const SHOW_TIMEOUT_MS = 3000
const SHOW_FRAME_TIMEOUT_MS = 250
// How long the toolbar says what became of a pick.
const PICK_NOTICE_MS = 6000

/** Who's calling: the id of the Browminal terminal an agent runs in, or null for any other agent. */
type Client = number | null

/**
 * The agent bridge: the local MCP server terminal agents connect to, which tabs they may touch,
 * and the debugger sessions on those tabs. Lives for the whole app, like Downloads.
 *
 * A tab is shared when the user shared it, when an agent opened it, or when a shared tab opened
 * it (a link with target=_blank). With "share every tab" on, all tabs are. Agents see nothing
 * else; unsharing a tab detaches the debugger from it.
 */
export class Agent {
  private readonly tokens: JsonStore<AgentFile>
  /** Tokens of agents started in Browminal terminals, each with its terminal's id. */
  private readonly sessionTokens = new Map<string, number>()
  private server: AgentServer | null = null
  private starting = false
  private error: string | null = null
  private readonly shared = new Set<number>()
  /** Tabs an agent opened: the only ones it may close. */
  private readonly opened = new Set<number>()
  /** The debugger and its logs, on shared tabs an agent used or the user shared. */
  private readonly debuggers = new Map<number, TabDebug>()
  /** The tab each client acted on last: tools that name no tab act on it again. */
  private readonly lastTabs = new Map<Client, number>()
  private inFlight = 0
  private asking = false
  private working: number | null = null
  private workingTimer: NodeJS.Timeout | null = null
  /** What the user picked to show agents (get_picks). */
  private readonly picks = new PickList()
  private picking: number | null = null
  private pickNotice: PickNotice | null = null
  private pickNoticeTimer: NodeJS.Timeout | null = null
  private readonly listeners = new Set<() => void>()

  constructor(
    folder: string,
    private readonly settings: JsonStore<Settings>,
    private readonly getMain: () => MainWindow | null
  ) {
    // Only the user may read it on macOS and Linux (Windows keeps userData private already).
    this.tokens = new JsonStore(join(folder, 'agent.json'), {
      parse: parseAgentFile,
      serialize: toAgentFile,
      mode: 0o600
    })
    // A token made just now is saved, so the command the user copied keeps working.
    this.tokens.set(this.tokens.get())
    if (this.enabled) this.startServer()
  }

  /** Called on every change to getState() or to which tabs are shared. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get enabled(): boolean {
    return this.settings.get().agent.enabled
  }

  get shareAll(): boolean {
    return this.settings.get().agent.shareAll
  }

  get token(): string {
    return this.tokens.get().token
  }

  /** Where the server listens; null while it's off, starting, or couldn't start. */
  get port(): number | null {
    return this.server?.port ?? null
  }

  getState(): AgentState {
    return {
      enabled: this.enabled,
      port: this.port,
      error: this.error,
      shareAll: this.shareAll,
      working: this.working,
      picking: this.picking,
      pick: this.pickNotice
    }
  }

  isShared(tabId: number): boolean {
    return this.enabled && (this.shareAll || this.shared.has(tabId))
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.saveSettings({ enabled })
    if (enabled) {
      this.startServer()
    } else {
      this.stopServer()
      this.releaseAll()
    }
    this.changed()
  }

  setShareAll(shareAll: boolean): void {
    if (shareAll === this.shareAll) return
    this.saveSettings({ shareAll })
    if (!shareAll) {
      for (const tabId of this.debuggers.keys()) if (!this.shared.has(tabId)) this.release(tabId)
    }
    this.changed()
  }

  /** Shares a tab, turning the bridge on if it's off. */
  share(tabId: number): void {
    this.shared.add(tabId)
    this.setEnabled(true)
    this.record(tabId)
    this.changed()
  }

  /** The agent button's "Share this tab" and Ctrl+Shift+A. */
  toggleShared(tabId: number): void {
    if (this.isShared(tabId)) {
      this.unshare(tabId)
      this.changed()
    } else {
      this.share(tabId)
    }
  }

  /** "Stop" while an agent works on a tab: the tab stops being shared, whatever shared it. */
  stop(tabId: number): void {
    this.unshare(tabId)
    if (this.shareAll) this.setShareAll(false)
    this.changed()
  }

  /** What an agent emulates on a tab, for the address bar badge; null when nothing. */
  emulationOf(tabId: number): string | null {
    return this.debuggers.get(tabId)?.emulationLabel ?? null
  }

  /** The badge's reset: the tab goes back to its own size, colours and network. */
  async resetEmulation(tabId: number): Promise<void> {
    await this.debuggers.get(tabId)?.emulate('reset')
  }

  /**
   * Ctrl+Shift+X: the user picks an element on tab `tabId` (DevTools' inspect highlight; the
   * next click picks), or stops picking. Picking shares the tab: the pick is for agents.
   */
  async togglePicking(tabId: number): Promise<void> {
    if (this.picking === tabId) return this.cancelPicking()
    this.cancelPicking()
    const tab = this.getMain()?.tabs.get(tabId)
    if (!tab || !canInspect(tab.webContents.getURL())) return
    this.share(tabId)
    const debug = this.debugOf(tab)
    this.picking = tabId
    this.changed()
    try {
      await debug.startPicking((ref) => {
        if (this.picking === tabId) {
          this.picking = null
          this.changed()
        }
        if (ref !== null) this.pickElement(tabId, ref)
      })
    } catch (error) {
      if (this.picking === tabId) this.picking = null
      this.notify({ id: null, kind: 'element', typed: false, error: (error as Error).message })
    }
  }

  /** Esc, or Cancel in the toolbar. */
  cancelPicking(): void {
    if (this.picking === null) return
    const tabId = this.picking
    this.picking = null
    this.debuggers.get(tabId)?.endPicking(null)
    this.changed()
  }

  /** "Send to agent" in a page's right-click menu: the element at (x, y), in CSS px. */
  async pickAt(tabId: number, x: number, y: number): Promise<void> {
    const tab = this.getMain()?.tabs.get(tabId)
    if (!tab || !canInspect(tab.webContents.getURL())) return
    this.share(tabId)
    try {
      const { backendNodeId } = await this.debugOf(tab).cdp.send<{ backendNodeId: number }>(
        'DOM.getNodeForLocation',
        { x: Math.round(x), y: Math.round(y), ignorePointerEventsNone: true }
      )
      this.pickElement(tabId, backendNodeId)
    } catch (error) {
      this.notify({ id: null, kind: 'element', typed: false, error: (error as Error).message })
    }
  }

  /** The errors badge: how many new errors tab `tabId`'s page has (0 unless it's shared). */
  errorsOf(tabId: number): number {
    return this.isShared(tabId) ? (this.debuggers.get(tabId)?.newErrors.length ?? 0) : 0
  }

  /** The errors popover's list: the newest of tab `tabId`'s new errors, in original files. */
  async errorRows(tabId: number): Promise<ErrorRow[]> {
    const debug = this.debuggers.get(tabId)
    if (!debug || !this.isShared(tabId)) return []
    const entries = debug.newErrors.slice(-3)
    const lookup = await debug.sourceMaps.resolveAll(positionsOf(entries)).catch(() => () => null)
    return errorRows(entries, lookup)
  }

  /** The errors popover's "Send to agent": the page's new errors become a pick. */
  async sendErrors(tabId: number): Promise<PickNotice | null> {
    const tab = this.getMain()?.tabs.get(tabId)
    const debug = this.debuggers.get(tabId)
    if (!tab || !debug || !this.isShared(tabId)) return null
    const capture = captureErrorsPick(tab, debug)
    debug.markErrorsSeen()
    return this.addPick(capture, 'errors')
  }

  /** The errors badge's "Dismiss". */
  dismissErrors(tabId: number): void {
    this.debuggers.get(tabId)?.markErrorsSeen()
  }

  /** "Try again" after the server couldn't start. */
  retry(): void {
    if (!this.enabled || this.server || this.starting) return
    this.error = null
    this.startServer()
    this.changed()
  }

  /**
   * A token of its own for the agent started in terminal `terminalId`: it lets that agent in, as
   * that terminal (so tools that name no tab act on its tab), until it's dropped with the session.
   */
  sessionToken(terminalId: number): string {
    const token = newAgentToken()
    this.sessionTokens.set(token, terminalId)
    return token
  }

  dropSessionToken(token: string): void {
    this.sessionTokens.delete(token)
  }

  /** A new token: agents set up with the old one are refused from the next request on. */
  renewToken(): void {
    this.tokens.set({ token: newAgentToken() })
    this.changed()
  }

  /** Resolves with the port once the server listens; rejects if it's off or couldn't start. */
  whenListening(): Promise<number> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        if (this.port !== null) resolve(this.port)
        else if (!this.enabled) reject(new Error('Agents are off'))
        else if (this.error) reject(new Error(`Agents can’t connect: ${this.error}`))
        else return false
        return true
      }
      if (check()) return
      const timer = setTimeout(() => {
        stop()
        reject(new Error('The agent server didn’t start'))
      }, START_TIMEOUT_MS)
      const stop = this.onChange(() => {
        if (!check()) return
        clearTimeout(timer)
        stop()
      })
    })
  }

  /** Every tab goes through here when it's created (tabs a shared tab opens are shared too). */
  watchTab(tab: Tab): void {
    if (tab.openerId !== null && this.shared.has(tab.openerId)) {
      this.shared.add(tab.id)
      this.record(tab.id, tab)
    }
    tab.webContents.once('destroyed', () => {
      this.shared.delete(tab.id)
      this.opened.delete(tab.id)
      this.debuggers.delete(tab.id)
      if (this.picking === tab.id) {
        this.picking = null
        this.changed()
      }
      for (const [client, id] of this.lastTabs) if (id === tab.id) this.lastTabs.delete(client)
    })
  }

  /** Before quitting. */
  dispose(): void {
    this.stopServer()
    this.releaseAll()
    this.tokens.flush()
  }

  /**
   * What the tools of one request use. An agent in a Browminal terminal works on that terminal's
   * tab when it names none; each client keeps its own "tab used last".
   */
  contextFor(client: Client): AgentContext {
    return {
      listTabs: () => this.listTabs(),
      tab: (tabId) => this.tab(tabId, client),
      cdp: (tab) => this.debugOf(tab).cdp,
      debug: (tab) => this.debugOf(tab),
      confirm: (question) => this.confirm(question),
      run: (tab, work) => this.run(tab, work, client),
      openTab: (url, background) => this.openTab(url, background, client),
      closeTab: (tabId) => this.closeTab(tabId),
      selectTab: (tabId) => {
        const tab = this.tab(tabId, client)
        this.getMain()?.tabs.activate(tab.id)
        this.lastTabs.set(client, tab.id)
        return tab
      },
      picks: () => this.picks
    }
  }

  private listTabs(): AgentTab[] {
    const main = this.getMain()
    if (!main) return []
    const active = main.tabs.active
    return main.tabs.all.map((tab) => {
      const { title, url } = tab.getSummary()
      return { id: tab.id, url, title, isActive: tab === active, shared: this.isShared(tab.id) }
    })
  }

  private tab(tabId: number | undefined, client: Client): Tab {
    const main = this.getMain()
    if (!main) throw new Error('No Browminal window is open')
    const terminalTab = client === null ? null : main.terminals.tabOf(client)
    const id =
      tabId ?? defaultAgentTab(this.listTabs(), this.lastTabs.get(client) ?? null, terminalTab)
    if (id === null) {
      throw new Error(
        'No tab given and no obvious one: call list_tabs and pass a tabId, or open one with new_tab'
      )
    }
    const tab = main.tabs.get(id)
    if (!tab || !this.isShared(id)) {
      throw new Error(
        `Tab ${id} isn’t shared with agents (or isn’t open). The user shares a tab with the ` +
          'agent button in Browminal’s toolbar.'
      )
    }
    return tab
  }

  /** The window is in front again: pages kept awake for agents (see run) are as usual again. */
  windowShown(): void {
    for (const debug of this.debuggers.values()) debug.sleep()
  }

  private debugOf(tab: Tab): TabDebug {
    let debug = this.debuggers.get(tab.id)
    if (!debug) {
      debug = new TabDebug(tab.webContents, () => this.changed())
      this.debuggers.set(tab.id, debug)
      debug.start()
    }
    return debug
  }

  private pickElement(tabId: number, ref: number): void {
    const tab = this.getMain()?.tabs.get(tabId)
    const debug = this.debuggers.get(tabId)
    if (!tab || !debug) return
    void this.addPick(captureElementPick(tab, debug, ref), 'element')
  }

  /**
   * Keeps a pick and hands it to the agent in the tab's Browminal terminal, if one runs there.
   * Returns what became of it (null: nothing to pick).
   */
  private async addPick(
    capture: Promise<NewPick | null>,
    kind: PickNotice['kind']
  ): Promise<PickNotice | null> {
    let pick
    try {
      const captured = await capture
      if (!captured) return null
      pick = this.picks.add(captured)
    } catch (error) {
      const notice = { id: null, kind, typed: false, error: (error as Error).message }
      this.notify(notice)
      return notice
    }
    const typed = this.getMain()?.terminals.typeForAgent(pick.tabId, pickPrompt(pick)) ?? false
    const notice = { id: pick.id, kind, typed, error: null }
    this.notify(notice)
    return notice
  }

  /** Shows what became of a pick in the toolbar for a few seconds. */
  private notify(notice: PickNotice): void {
    this.pickNotice = notice
    if (this.pickNoticeTimer) clearTimeout(this.pickNoticeTimer)
    this.pickNoticeTimer = setTimeout(() => {
      this.pickNoticeTimer = null
      this.pickNotice = null
      this.changed()
    }, PICK_NOTICE_MS)
    this.changed()
  }

  /** Attaches to a tab that was just shared, so its console and network are kept from now on. */
  private record(tabId: number, tab = this.getMain()?.tabs.get(tabId)): void {
    if (tab && this.isShared(tabId)) this.debugOf(tab)
  }

  /** Asks the user on an agent's behalf (marked as an agent's request). */
  private async confirm(question: AgentQuestion): Promise<boolean> {
    const main = this.getMain()
    if (!main || main.window.isDestroyed()) return false
    // One question at a time, so an agent can't stack up questions.
    if (this.asking) throw new Error('The user is already being asked something: try again later')
    this.asking = true
    try {
      const answer = await main.overlay.ask(
        {
          icon: 'agent',
          site: '',
          message: question.message,
          detail: question.detail,
          code: null,
          fromAgent: true,
          confirm: question.action,
          cancel: 'Cancel',
          destructive: question.destructive
        },
        null
      )
      return answer === true
    } finally {
      this.asking = false
    }
  }

  private async run<T>(tab: Tab, work: () => Promise<T>, client: Client): Promise<T> {
    this.lastTabs.set(client, tab.id)
    this.inFlight++
    if (this.workingTimer) clearTimeout(this.workingTimer)
    this.workingTimer = null
    if (this.working !== tab.id) {
      this.working = tab.id
      this.changed()
    }
    try {
      // A tab just brought to the front (new_tab, select_tab, the user) is hidden until it's
      // shown, and drops input meanwhile; once it's shown, one frame means it's visible.
      if (await this.getMain()?.tabs.whenShown(tab, SHOW_TIMEOUT_MS)) {
        await tab.nextFrame(SHOW_FRAME_TIMEOUT_MS)
      }
      // The window may be minimized or behind other windows, where pages drop clicks.
      if (canInspect(tab.webContents.getURL())) await this.debugOf(tab).wakeIfHidden()
      return await work()
    } finally {
      this.inFlight--
      if (this.inFlight === 0) {
        this.workingTimer = setTimeout(() => {
          this.workingTimer = null
          this.working = null
          this.changed()
        }, WORKING_LINGER_MS)
      }
    }
  }

  private async openTab(url: string, background: boolean, client: Client): Promise<Tab> {
    const main = this.getMain()
    if (!main) throw new Error('No Browminal window is open')
    // Blank first: the logs start before the page's first request.
    const tab = main.tabs.create({ url: 'about:blank', background, openerId: null })
    this.shared.add(tab.id)
    this.opened.add(tab.id)
    this.lastTabs.set(client, tab.id)
    this.changed()
    await this.debugOf(tab)
      .cdp.attach()
      .catch(() => {})
    if (!tab.webContents.isDestroyed()) tab.load(url)
    return tab
  }

  private closeTab(tabId: number): void {
    const main = this.getMain()
    if (!main?.tabs.get(tabId)) throw new Error(`Tab ${tabId} isn’t open`)
    if (!this.opened.has(tabId)) {
      throw new Error(`Tab ${tabId} was opened by the user; only tabs from new_tab can be closed`)
    }
    main.tabs.close(tabId)
  }

  private unshare(tabId: number): void {
    this.shared.delete(tabId)
    this.release(tabId)
  }

  /** Lets go of a tab's debugger, ending anything an agent was doing there. */
  private release(tabId: number): void {
    this.debuggers.get(tabId)?.dispose()
    this.debuggers.delete(tabId)
    if (this.working === tabId) {
      this.working = null
      if (this.workingTimer) clearTimeout(this.workingTimer)
      this.workingTimer = null
    }
  }

  private releaseAll(): void {
    for (const tabId of [...this.debuggers.keys()]) this.release(tabId)
  }

  private saveSettings(change: Partial<Settings['agent']>): void {
    const settings = this.settings.get()
    this.settings.set({ ...settings, agent: { ...settings.agent, ...change } })
  }

  private startServer(): void {
    if (this.server || this.starting) return
    this.starting = true
    startAgentServer({
      port: this.settings.get().agent.port,
      tokens: () => [this.token, ...this.sessionTokens.keys()],
      createMcp: (token) =>
        createAgentMcp(this.contextFor(this.sessionTokens.get(token) ?? null), app.getVersion())
    }).then(
      (server) => {
        this.starting = false
        this.error = null
        this.server = server
        // Switched off while it was starting.
        if (!this.enabled) this.stopServer()
        this.changed()
      },
      (error: Error) => {
        this.starting = false
        this.error = error.message
        this.changed()
      }
    )
  }

  private stopServer(): void {
    this.server?.close()
    this.server = null
    this.error = null
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}
