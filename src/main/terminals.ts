import { dialog, WebContentsView, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { spawn, type IPty } from '@lydell/node-pty'
import {
  PAGE_RADIUS,
  panelPlacement,
  TERMINAL_EXIT_BAR_HEIGHT,
  type PanelDock,
  type Rect
} from '../shared/layout'
import { agentBrand } from '../shared/agents'
import { TerminalViewChannel } from '../shared/terminal-view'
import type { TerminalPanelState, TerminalSession } from '../shared/types'
import { isHttpUrl } from '../shared/url'
import type { Agent } from './agent'
import { canInspect, mcpConfigJson } from './agent-policy'
import type { Settings } from './settings'
import type { JsonStore } from './store'
import type { TabManager } from './tab-manager'
import {
  agentCommandLine,
  agentShell,
  agentSuggestions,
  agentTitle,
  appendOutput,
  defaultShell,
  folderName,
  MCP_CONFIG_ENV,
  rememberAgentCommand,
  sessionTitle,
  siteKey,
  type Shell
} from './terminal-policy'
import { onThemeChange, themeColors } from './theme'

const MAX_SESSIONS = 10
// Written into a restarted terminal, between the old shell's output and the new one's.
const RESTARTED_NOTICE = '\r\n\x1b[2m[Restarted]\x1b[0m\r\n'

interface Session extends Omit<TerminalSession, 'agent' | 'brand' | 'folder'> {
  /** The folder the shell started in. */
  cwd: string
  pty: IPty
  shell: Shell
  /** Output so far, replayed if the terminal view reloads. */
  buffer: string
  /** For an agent session: what it runs, its own token and its MCP config (both end with it). */
  agent: { command: string; token: string | null; configPath: string | null } | null
}

/** The terminal view's page: served by the dev server, or the built file. */
export function terminalPageUrl(): string | null {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return is.dev && devUrl ? `${devUrl}/terminal.html` : null
}

/**
 * The terminal panel of a window: shells (one pty each) shown by the terminal view, its own
 * sandboxed WebContentsView with xterm and a preload of a few terminal functions. Every session
 * works on a tab: the agent started in it acts on that tab when it names none. Sessions keep
 * running while the panel is hidden; they end when closed or when the window closes.
 *
 * With no session shown, the UI draws the start page in the panel: a project folder and an agent
 * command (claude, codex, any other) to start an agent session on the active tab.
 */
export class Terminals {
  readonly view: WebContentsView
  private sessions: Session[] = []
  /** The session shown; null: the start page. */
  private activeId: number | null = null
  /** The folder chosen on a tab without a site (the start page), for this run only. */
  private looseFolder: string | null = null
  private isOpen = false
  /** Where the layout last put the terminal view (null: off screen). */
  private bounds: Rect | null = null
  private viewReady = false
  private disposed = false
  private readonly listeners = new Set<() => void>()
  private readonly stopWatchingTheme: () => void
  private readonly configFolder: string

  constructor(
    private readonly window: BrowserWindow,
    private readonly tabs: TabManager,
    private readonly settings: JsonStore<Settings>,
    private readonly agent: Agent,
    userData: string
  ) {
    this.configFolder = join(userData, 'agent-mcp')
    // Configs left by a crash: their sessions are gone.
    rmSync(this.configFolder, { recursive: true, force: true })

    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/terminal.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    this.view.setBackgroundColor(themeColors().console)
    this.view.setBorderRadius(PAGE_RADIUS)
    const wc = this.view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (event) => event.preventDefault())
    wc.on('will-attach-webview', (event) => event.preventDefault())
    wc.on('did-start-loading', () => (this.viewReady = false))
    const devUrl = terminalPageUrl()
    if (devUrl) wc.loadURL(devUrl)
    else wc.loadFile(join(__dirname, '../renderer/terminal.html'))

    this.stopWatchingTheme = onThemeChange(() => {
      if (!wc.isDestroyed()) this.view.setBackgroundColor(themeColors().console)
    })
    tabs.onLayout((bounds) => this.place(bounds))
    tabs.onTabCreated((tab) => {
      tab.webContents.once('destroyed', () => {
        let changed = false
        for (const session of this.sessions) {
          if (session.tabId === tab.id) {
            session.tabId = null
            changed = true
          }
        }
        if (changed) this.changed()
      })
    })
  }

  /** Called on every change to getState(). Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): TerminalPanelState {
    const { dock, height, width, agentCommands } = this.settings.get().terminal
    const folder = this.folderFor(this.tabs.active.url)
    return {
      open: this.isOpen,
      dock,
      height,
      width,
      sessions: this.sessions.map(({ id, title, tabId, cwd, exited, exitCode, agent }) => ({
        id,
        title,
        tabId,
        folder: folderName(cwd),
        exited,
        exitCode,
        agent: agent !== null,
        brand: agent === null ? null : agentBrand(agent.command)
      })),
      activeId: this.activeId,
      folder: folder === null ? null : folderName(folder),
      site: siteKey(this.tabs.active.url),
      agentCommands: agentSuggestions(agentCommands)
    }
  }

  get(id: number): Session | undefined {
    return this.sessions.find((session) => session.id === id)
  }

  /** The tab terminal `id` works on, if it's still open. */
  tabOf(id: number): number | null {
    return this.get(id)?.tabId ?? null
  }

  /** Ctrl+`: shows the panel (the start page if no session runs) and focuses it, or hides it. */
  toggle(): void {
    if (this.isOpen) this.hide()
    else this.show()
  }

  /** The panel's agent button: the start page, the sessions staying in the header. */
  showStartPage(): void {
    this.activeId = null
    this.sendSessions()
    this.placeView()
    this.show()
  }

  /**
   * A new shell working on the active tab, in `cwd`, the folder chosen for its site, or home.
   * Returns its id.
   */
  create(cwd?: string): number {
    this.checkRoom()
    const tab = this.tabs.active
    const shell = defaultShell(process.platform, process.env)
    const folder = cwd ?? this.folderFor(tab.url) ?? homedir()
    return this.add({
      id: nextId(),
      title: shell.name,
      tabId: tab.id,
      cwd: folder,
      shell,
      pty: this.spawnShell(shell, folder),
      agent: null
    })
  }

  /**
   * "Start session" on the start page: a new terminal running only `command` (an agent: claude,
   * codex, any other), connected to Browminal, in the folder chosen for the active tab's site
   * (asked for first if there is none). It works on that tab and shares it. The agent is
   * remembered for next time.
   */
  async startAgent(command: string): Promise<void> {
    this.checkRoom()
    const tab = this.tabs.active
    const folder = this.folderFor(tab.url) ?? (await this.chooseFolder())
    if (folder === null || this.disposed) return
    const settings = this.settings.get()
    const agentCommands = rememberAgentCommand(settings.terminal.agentCommands, command)
    this.settings.set({ ...settings, terminal: { ...settings.terminal, agentCommands } })

    this.agent.share(tab.id)
    const port = await this.agent.whenListening()
    if (this.disposed) return
    this.checkRoom()
    const id = nextId()
    const shell = defaultShell(process.platform, process.env)
    const agent = { command, token: null, configPath: null }
    this.add({
      id,
      title: agentTitle(command),
      tabId: this.tabs.get(tab.id) ? tab.id : null,
      cwd: folder,
      shell,
      pty: this.spawnAgent(id, agent, shell, folder, port),
      agent
    })
  }

  /**
   * "Restart" under an exited terminal: the same shell, or the same agent (with a fresh token and
   * config: the port may have changed), in the same folder, working on the same tab.
   */
  async restart(id: number): Promise<void> {
    const session = this.get(id)
    if (!session || !session.exited) return
    const cwd = existsSync(session.cwd) ? session.cwd : homedir()
    if (session.agent) {
      if (session.tabId !== null) this.agent.share(session.tabId)
      const port = await this.agent.whenListening()
      // Closed, or restarted by another click, meanwhile.
      if (this.disposed || this.get(id) !== session || !session.exited) return
      this.endAgent(session)
      session.pty = this.spawnAgent(id, session.agent, session.shell, cwd, port)
    } else {
      session.pty = this.spawnShell(session.shell, cwd)
    }
    session.exited = false
    session.exitCode = null
    session.buffer = appendOutput(session.buffer, RESTARTED_NOTICE)
    this.send(TerminalViewChannel.Output, session.id, RESTARTED_NOTICE)
    this.watch(session)
    this.activeId = id
    this.sendSessions()
    this.placeView()
    this.focus()
    this.changed()
  }

  /** Ends a shell and takes its terminal away. The panel stays open, empty, after the last one. */
  close(id: number): void {
    const session = this.get(id)
    if (!session) return
    this.end(session)
    this.sessions = this.sessions.filter((other) => other !== session)
    if (this.activeId === id) this.activeId = this.sessions.at(-1)?.id ?? null
    this.sendSessions()
    this.placeView()
    if (this.sessions.length === 0 && !this.window.isDestroyed()) {
      this.tabs.active.webContents.focus()
    }
    this.changed()
  }

  select(id: number): void {
    if (!this.get(id)) return
    this.activeId = id
    this.sendSessions()
    this.placeView()
    this.focus()
    this.changed()
  }

  /** The panel's size across its dock, from the UI's drag (clamped again by the layout). */
  setSize(px: number): void {
    const settings = this.settings.get()
    const key = settings.terminal.dock === 'bottom' ? 'height' : 'width'
    if (settings.terminal[key] === px) return
    this.settings.set({ ...settings, terminal: { ...settings.terminal, [key]: px } })
    this.placePanel()
    this.changed()
  }

  /** Moves the panel under the page or to its right; it keeps the size it last had there. */
  setDock(dock: PanelDock): void {
    const settings = this.settings.get()
    if (settings.terminal.dock === dock) return
    this.settings.set({ ...settings, terminal: { ...settings.terminal, dock } })
    this.placePanel()
    this.focus()
    this.changed()
  }

  /** Points terminal `id` (and its agent) at the active tab. */
  attach(id: number): void {
    const session = this.get(id)
    if (!session) return
    session.tabId = this.tabs.active.id
    this.changed()
  }

  /**
   * Types `text` into the prompt of an agent started from the start page in a terminal that
   * works on tab `tabId` (the active one if several), without sending it, and shows that
   * terminal. False when no such agent runs.
   */
  typeForAgent(tabId: number, text: string): boolean {
    const agents = this.sessions.filter(
      (session) => session.tabId === tabId && session.agent !== null && !session.exited
    )
    const session = agents.find((other) => other.id === this.activeId) ?? agents.at(-1)
    if (!session) return false
    session.pty.write(text)
    this.activeId = session.id
    this.sendSessions()
    this.show()
    return true
  }

  /**
   * Asks for the project folder agents work in and remembers it for the active tab's site (for
   * this run only on a tab without one). Returns it, or null if the user cancelled.
   */
  async chooseFolder(): Promise<string | null> {
    const site = siteKey(this.tabs.active.url)
    const result = await dialog.showOpenDialog(this.window, {
      title: site ? `Project folder for ${site}` : 'Project folder',
      properties: ['openDirectory']
    })
    const folder = result.filePaths[0]
    if (result.canceled || !folder || this.disposed) return null
    if (site) {
      const settings = this.settings.get()
      const folders = { ...settings.terminal.folders, [site]: folder }
      this.settings.set({ ...settings, terminal: { ...settings.terminal, folders } })
    } else {
      this.looseFolder = folder
    }
    this.changed()
    return folder
  }

  // From the terminal view (checked in ipc.ts).

  input(id: number, data: string): void {
    const session = this.get(id)
    if (session && !session.exited) session.pty.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    const session = this.get(id)
    if (!session || session.exited) return
    try {
      session.pty.resize(cols, rows)
    } catch {
      // The shell exited a moment ago.
    }
  }

  /**
   * A link clicked in a terminal (a dev server's "Local: http://localhost:5173"): it opens in the
   * terminal's tab if that shows no web page yet (the start page), else in a new tab next to it,
   * and the terminal then works on that tab.
   */
  openLink(id: number, url: string): void {
    const session = this.get(id)
    if (!session || !isHttpUrl(url)) return
    const tab = session.tabId === null ? undefined : this.tabs.get(session.tabId)
    if (tab && !canInspect(tab.webContents.getURL())) {
      tab.load(url)
      this.tabs.activate(tab.id)
    } else {
      const opened = this.tabs.create({ url, openerId: tab?.id ?? null })
      session.tabId = opened.id
    }
    this.changed()
  }

  /** The view (re)loaded and listens: it gets the sessions and their output so far. */
  viewLoaded(): void {
    this.viewReady = true
    this.sendSessions()
    for (const session of this.sessions) {
      if (session.buffer) this.send(TerminalViewChannel.Output, session.id, session.buffer)
    }
    if (this.isOpen) this.focus()
  }

  focus(): void {
    if (!this.isOpen || this.window.isDestroyed()) return
    // The start page is the UI's: the keyboard goes there.
    if (this.activeId === null) return this.window.webContents.focus()
    if (!this.bounds || this.view.webContents.isDestroyed()) return
    this.view.webContents.focus()
    this.send(TerminalViewChannel.Focus)
  }

  /** Ends every shell. Call when the window closes. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.stopWatchingTheme()
    for (const session of this.sessions) this.end(session)
    this.sessions = []
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  private show(): void {
    this.isOpen = true
    this.placePanel()
    this.focus()
    this.changed()
  }

  private hide(): void {
    this.isOpen = false
    this.tabs.setPanel(null)
    if (!this.window.isDestroyed()) this.tabs.active.webContents.focus()
    this.changed()
  }

  /** Tells the layout where the open panel goes and how big it is. */
  private placePanel(): void {
    if (this.isOpen) this.tabs.setPanel(panelPlacement(this.settings.get().terminal))
  }

  /** The layout says where the terminal view goes (null: off screen). */
  private place(bounds: Rect | null): void {
    this.bounds = bounds
    this.placeView()
  }

  /**
   * Puts the view where the layout says, or takes it off screen (panel hidden, fullscreen page,
   * no session shown: the UI draws the start page). Under an exited shell the UI's exit bar takes
   * the bottom of the panel.
   */
  private placeView(): void {
    if (this.window.isDestroyed() || this.view.webContents.isDestroyed()) return
    const content = this.window.contentView
    const attached = content.children.includes(this.view)
    const bounds = this.bounds
    if (!bounds || !this.isOpen || this.activeId === null) {
      if (attached) content.removeChildView(this.view)
      return
    }
    const exited = this.get(this.activeId ?? -1)?.exited ?? false
    const bar = exited ? Math.min(TERMINAL_EXIT_BAR_HEIGHT, bounds.height) : 0
    this.view.setBounds({ ...bounds, height: bounds.height - bar })
    if (!attached) content.addChildView(this.view)
  }

  private checkRoom(): void {
    if (this.sessions.length >= MAX_SESSIONS) throw new Error('Too many terminals')
  }

  /** Adds a just-spawned terminal, shows it and returns its id. */
  private add(fields: Omit<Session, 'exited' | 'exitCode' | 'buffer'>): number {
    const session: Session = {
      ...fields,
      title: sessionTitle(
        fields.title,
        this.sessions.map((other) => other.title)
      ),
      exited: false,
      exitCode: null,
      buffer: ''
    }
    this.watch(session)
    this.sessions.push(session)
    this.activeId = session.id
    this.sendSessions()
    this.show()
    return session.id
  }

  /**
   * Starts terminal `id`'s agent, connected with a token of its own (it acts as this terminal, so
   * on its tab) and an MCP config file with that token, readable by the user only.
   */
  private spawnAgent(
    id: number,
    agent: NonNullable<Session['agent']>,
    shell: Shell,
    cwd: string,
    port: number
  ): IPty {
    agent.token = this.agent.sessionToken(id)
    mkdirSync(this.configFolder, { recursive: true })
    agent.configPath = join(this.configFolder, `terminal-${id}.json`)
    writeFileSync(agent.configPath, `${mcpConfigJson(port, agent.token)}\n`, { mode: 0o600 })
    const connection = { port, token: agent.token, configPath: agent.configPath }
    const line = agentCommandLine(agent.command, connection, shell.kind)
    return this.spawnShell(agentShell(shell, line), cwd, { [MCP_CONFIG_ENV]: agent.configPath })
  }

  private spawnShell(shell: Shell, cwd: string, env: Record<string, string> = {}): IPty {
    return spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...shellEnvironment(), ...env }
    })
  }

  /** Relays a session's shell output, and notices when the shell exits. */
  private watch(session: Session): void {
    const { pty } = session
    pty.onData((data) => {
      if (session.pty !== pty) return
      session.buffer = appendOutput(session.buffer, data)
      this.send(TerminalViewChannel.Output, session.id, data)
    })
    pty.onExit(({ exitCode }) => {
      if (this.disposed || !this.get(session.id) || session.pty !== pty) return
      session.exited = true
      session.exitCode = Number.isInteger(exitCode) ? exitCode : null
      this.sendSessions()
      this.placeView()
      this.changed()
    })
  }

  /** The project folder chosen for `url`'s site (or, without a site, this run's), if it's there. */
  private folderFor(url: string): string | null {
    const site = siteKey(url)
    const folder = site ? this.settings.get().terminal.folders[site] : this.looseFolder
    return folder && existsSync(folder) ? folder : null
  }

  private end(session: Session): void {
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
    this.endAgent(session)
  }

  /** The agent's token stops working and its config file goes. */
  private endAgent({ agent }: Session): void {
    if (!agent) return
    if (agent.token) this.agent.dropSessionToken(agent.token)
    if (agent.configPath) rmSync(agent.configPath, { force: true })
    agent.token = null
    agent.configPath = null
  }

  private sendSessions(): void {
    this.send(
      TerminalViewChannel.Sessions,
      this.sessions.map(({ id, exited }) => ({ id, exited })),
      this.activeId
    )
  }

  private send(channel: string, ...args: unknown[]): void {
    if (this.viewReady && !this.view.webContents.isDestroyed()) {
      this.view.webContents.send(channel, ...args)
    }
  }

  private changed(): void {
    if (!this.disposed) for (const listener of this.listeners) listener()
  }
}

/** The shell's environment: the app's, minus Electron's own switches, plus who's hosting it. */
function shellEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('ELECTRON_')) env[key] = value
  }
  env.TERM_PROGRAM = 'Browminal'
  env.COLORTERM = 'truecolor'
  return env
}

let lastId = 0
const nextId = (): number => ++lastId
