import { app } from 'electron'
import { join } from 'path'
import type { AgentState } from '../shared/types'
import { newAgentToken, parseAgentFile, toAgentFile, type AgentFile } from './agent-auth'
import { defaultAgentTab, type AgentTab } from './agent-policy'
import { startAgentServer, type AgentServer } from './agent-server'
import { createAgentMcp, type AgentContext } from './agent-tools'
import { CdpSession } from './cdp'
import type { Settings } from './settings'
import { JsonStore } from './store'
import type { Tab } from './tabs'
import type { MainWindow } from './window'

// After its last command an agent still counts as working this long, so the mark doesn't flicker.
const WORKING_LINGER_MS = 2000
// How long whenListening waits for the server to start.
const START_TIMEOUT_MS = 10_000

/** Who's calling: the id of the Nebula terminal an agent runs in, or null for any other agent. */
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
  private server: AgentServer | null = null
  private starting = false
  private error: string | null = null
  private readonly shared = new Set<number>()
  /** Tabs an agent opened: the only ones it may close. */
  private readonly opened = new Set<number>()
  private readonly sessions = new Map<number, CdpSession>()
  /** The tab each client acted on last: tools that name no tab act on it again. */
  private readonly lastTabs = new Map<Client, number>()
  private inFlight = 0
  private working: number | null = null
  private workingTimer: NodeJS.Timeout | null = null
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
      working: this.working
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
      for (const tabId of this.sessions.keys()) if (!this.shared.has(tabId)) this.release(tabId)
    }
    this.changed()
  }

  /** Shares a tab, turning the bridge on if it's off. */
  share(tabId: number): void {
    this.shared.add(tabId)
    this.setEnabled(true)
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
    if (tab.openerId !== null && this.shared.has(tab.openerId)) this.shared.add(tab.id)
    tab.webContents.once('destroyed', () => {
      this.shared.delete(tab.id)
      this.opened.delete(tab.id)
      this.sessions.delete(tab.id)
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
   * What the tools of one request use. An agent in a Nebula terminal works on that terminal's
   * tab when it names none; each client keeps its own "tab used last".
   */
  contextFor(client: Client): AgentContext {
    return {
      listTabs: () => this.listTabs(),
      tab: (tabId) => this.tab(tabId, client),
      cdp: (tab) => this.cdp(tab),
      run: (tab, work) => this.run(tab, work, client),
      openTab: (url, background) => this.openTab(url, background, client),
      closeTab: (tabId) => this.closeTab(tabId),
      selectTab: (tabId) => {
        const tab = this.tab(tabId, client)
        this.getMain()?.tabs.activate(tab.id)
        this.lastTabs.set(client, tab.id)
        return tab
      }
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
    if (!main) throw new Error('No Nebula window is open')
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
          'agent button in Nebula’s toolbar.'
      )
    }
    return tab
  }

  private cdp(tab: Tab): CdpSession {
    let session = this.sessions.get(tab.id)
    if (!session) {
      session = new CdpSession(tab.webContents)
      this.sessions.set(tab.id, session)
    }
    return session
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

  private openTab(url: string, background: boolean, client: Client): Tab {
    const main = this.getMain()
    if (!main) throw new Error('No Nebula window is open')
    const tab = main.tabs.create({ url, background, openerId: null })
    this.shared.add(tab.id)
    this.opened.add(tab.id)
    this.lastTabs.set(client, tab.id)
    this.changed()
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
    this.sessions.get(tabId)?.detach()
    this.sessions.delete(tabId)
    if (this.working === tabId) {
      this.working = null
      if (this.workingTimer) clearTimeout(this.workingTimer)
      this.workingTimer = null
    }
  }

  private releaseAll(): void {
    for (const tabId of [...this.sessions.keys()]) this.release(tabId)
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
      token: () => this.token,
      createMcp: (terminalId) => createAgentMcp(this.contextFor(terminalId), app.getVersion())
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
