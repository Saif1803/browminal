import { dialog, WebContentsView, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { spawn, type IPty } from '@lydell/node-pty'
import { PAGE_RADIUS, panelPlacement, type PanelDock, type Rect } from '../shared/layout'
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
  appendOutput,
  defaultShell,
  sessionTitle,
  siteKey,
  type Shell
} from './terminal-policy'
import { onThemeChange, themeColors } from './theme'

const MAX_SESSIONS = 10
const EXITED_NOTICE =
  '\r\n\x1b[2m[The shell has exited. Close this terminal or open a new one.]\x1b[0m\r\n'

interface Session extends TerminalSession {
  pty: IPty
  shell: Shell
  /** Output so far, replayed if the terminal view reloads. */
  buffer: string
  /** The MCP config written for an agent started here, deleted with the session. */
  configPath: string | null
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
 */
export class Terminals {
  readonly view: WebContentsView
  private sessions: Session[] = []
  private activeId: number | null = null
  private isOpen = false
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
    const { dock, height, width } = this.settings.get().terminal
    return {
      open: this.isOpen,
      dock,
      height,
      width,
      sessions: this.sessions.map(({ id, title, tabId, cwd, exited }) => ({
        id,
        title,
        tabId,
        cwd,
        exited
      })),
      activeId: this.activeId
    }
  }

  get(id: number): Session | undefined {
    return this.sessions.find((session) => session.id === id)
  }

  /** The tab terminal `id` works on, if it's still open. */
  tabOf(id: number): number | null {
    return this.get(id)?.tabId ?? null
  }

  /** Ctrl+`: shows the panel (opening a terminal if there is none) and focuses it, or hides it. */
  toggle(): void {
    if (this.isOpen) this.hide()
    else if (this.sessions.length === 0) this.create()
    else this.show()
  }

  /** A new shell working on the active tab, in `cwd` or the folder remembered for its site. */
  create(cwd?: string): void {
    if (this.sessions.length >= MAX_SESSIONS) throw new Error('Too many terminals')
    const tab = this.tabs.active
    const shell = defaultShell(process.platform, process.env)
    const folder = cwd ?? this.folderFor(tab.url)
    const pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: folder,
      env: shellEnvironment()
    })
    const session: Session = {
      id: nextId(),
      title: sessionTitle(
        shell.name,
        this.sessions.map((other) => other.title)
      ),
      tabId: tab.id,
      cwd: folder,
      exited: false,
      pty,
      shell,
      buffer: '',
      configPath: null
    }
    pty.onData((data) => {
      session.buffer = appendOutput(session.buffer, data)
      this.send(TerminalViewChannel.Output, session.id, data)
    })
    pty.onExit(() => {
      if (this.disposed || !this.get(session.id)) return
      session.exited = true
      session.buffer = appendOutput(session.buffer, EXITED_NOTICE)
      this.send(TerminalViewChannel.Output, session.id, EXITED_NOTICE)
      this.sendSessions()
      this.changed()
    })
    this.sessions.push(session)
    this.activeId = session.id
    this.sendSessions()
    this.show()
  }

  close(id: number): void {
    const session = this.get(id)
    if (!session) return
    this.end(session)
    this.sessions = this.sessions.filter((other) => other !== session)
    if (this.activeId === id) this.activeId = this.sessions.at(-1)?.id ?? null
    this.sendSessions()
    if (this.sessions.length === 0) this.hide()
    else this.changed()
  }

  select(id: number): void {
    if (!this.get(id)) return
    this.activeId = id
    this.sendSessions()
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
   * The panel's Claude button: shares the terminal's tab, writes an MCP config for this terminal
   * (port, token, and which terminal it is) and types the agent command into the shell.
   */
  async startAgent(id: number): Promise<void> {
    const session = this.get(id)
    if (!session || session.exited) return
    if (session.tabId === null || !this.tabs.get(session.tabId)) session.tabId = this.tabs.active.id
    this.agent.share(session.tabId)
    const port = await this.agent.whenListening()
    if (this.disposed || session.exited || !this.get(id)) return

    mkdirSync(this.configFolder, { recursive: true })
    const configPath = join(this.configFolder, `terminal-${id}.json`)
    writeFileSync(configPath, `${mcpConfigJson(port, this.agent.token, id)}\n`, { mode: 0o600 })
    session.configPath = configPath
    const { agentCommand } = this.settings.get().terminal
    session.pty.write(`${agentCommandLine(agentCommand, configPath, session.shell.kind)}\r`)
    this.select(id)
  }

  /**
   * Types `text` into the prompt of the agent started with the Claude button in a terminal that
   * works on tab `tabId` (the active one if several), without sending it, and shows that
   * terminal. False when no such agent runs.
   */
  typeForAgent(tabId: number, text: string): boolean {
    const agents = this.sessions.filter(
      (session) => session.tabId === tabId && session.configPath !== null && !session.exited
    )
    const session = agents.find((other) => other.id === this.activeId) ?? agents.at(-1)
    if (!session) return false
    session.pty.write(text)
    this.activeId = session.id
    this.sendSessions()
    this.show()
    return true
  }

  /** Asks for a project folder, remembers it for the active tab's site, opens a terminal there. */
  async chooseFolder(): Promise<void> {
    const site = siteKey(this.tabs.active.url)
    const result = await dialog.showOpenDialog(this.window, {
      title: site ? `Project folder for ${site}` : 'Open a terminal in…',
      properties: ['openDirectory']
    })
    const folder = result.filePaths[0]
    if (result.canceled || !folder || this.disposed) return
    if (site) {
      const settings = this.settings.get()
      const folders = { ...settings.terminal.folders, [site]: folder }
      this.settings.set({ ...settings, terminal: { ...settings.terminal, folders } })
    }
    this.create(folder)
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
    if (!this.isOpen || this.view.webContents.isDestroyed()) return
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

  /** Puts the view where the layout says, or takes it off screen (panel hidden, fullscreen page). */
  private place(bounds: Rect | null): void {
    if (this.window.isDestroyed() || this.view.webContents.isDestroyed()) return
    const content = this.window.contentView
    const attached = content.children.includes(this.view)
    if (!bounds || !this.isOpen) {
      if (attached) content.removeChildView(this.view)
      return
    }
    this.view.setBounds(bounds)
    if (!attached) content.addChildView(this.view)
  }

  private folderFor(url: string): string {
    const site = siteKey(url)
    const folder = site ? this.settings.get().terminal.folders[site] : undefined
    return folder && existsSync(folder) ? folder : homedir()
  }

  private end(session: Session): void {
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
    if (session.configPath) rmSync(session.configPath, { force: true })
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
