import { clipboard, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { clampTerminalHeight, MAX_CHROME_HEIGHT } from '../shared/layout'
import { IpcChannel, type Bookmark, type OpenDisposition } from '../shared/types'
import { TerminalViewChannel } from '../shared/terminal-view'
import { showAdblockMenu } from './adblock-menu'
import { showAgentMenu } from './agent-menu'
import { openBookmark } from './bookmarks'
import { showBookmarkMenu, showBookmarksOverflow } from './bookmarks-menu'
import { showDownloadsMenu } from './downloads-menu'
import { isTerminalSize, MAX_TERMINAL_INPUT } from './terminal-policy'
import type { MainWindow } from './window'

const MAX_INPUT_LENGTH = 8192
const MAX_FIND_LENGTH = 1000

const isDisposition = (value: unknown): value is OpenDisposition =>
  value === 'current' || value === 'foreground' || value === 'background'

const MAX_LINK_LENGTH = 8192
const MAX_COPY_LENGTH = 1024 * 1024
const MAX_TERMINAL_HEIGHT_INPUT = 10_000

type RendererPage = 'index.html' | 'terminal.html'

/**
 * The URL a renderer of ours is served from: the UI is index.html, the terminal view
 * terminal.html. Every IPC message must come from a top-level frame showing that page on the dev
 * server's origin, or that exact file (packaged).
 */
function isTrustedRendererUrl(url: string, page: RendererPage): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    try {
      const { origin, pathname } = new URL(url)
      if (origin !== new URL(devUrl).origin) return false
      return page === 'index.html'
        ? pathname === '/' || pathname === '/index.html'
        : pathname === `/${page}`
    } catch {
      return false
    }
  }
  const fileUrl = pathToFileURL(join(__dirname, '../renderer', page)).href
  return url.split(/[?#]/)[0] === fileUrl
}

const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

export function registerIpc(getMain: () => MainWindow | null): void {
  /** Throws unless the message came from the main window's UI, top frame, on the trusted URL. */
  const assertTrustedSender = (event: IpcMainInvokeEvent): MainWindow => {
    const main = getMain()
    const frame = event.senderFrame
    if (
      !main ||
      main.window.isDestroyed() ||
      event.sender !== main.window.webContents ||
      !frame ||
      frame.parent !== null ||
      !isTrustedRendererUrl(frame.url, 'index.html')
    ) {
      throw new Error(`Rejected IPC from untrusted sender: ${frame?.url ?? 'unknown'}`)
    }
    return main
  }

  /** Throws unless `id` is the id of an open tab. */
  const assertTabId = (main: MainWindow, id: unknown): number => {
    if (typeof id !== 'number' || !Number.isInteger(id) || !main.tabs.get(id)) {
      throw new Error('Expected the id of an open tab')
    }
    return id
  }

  /** Throws unless `id` is the id of a bookmark. */
  const assertBookmark = (main: MainWindow, id: unknown): Bookmark => {
    const bookmark = typeof id === 'number' ? main.bookmarks.get(id) : undefined
    if (!bookmark) throw new Error('Expected the id of a bookmark')
    return bookmark
  }

  /** Throws unless (x, y) is a point inside the window in whole px (where a menu pops up). */
  const assertPoint = (main: MainWindow, x: unknown, y: unknown): { x: number; y: number } => {
    const { width, height } = main.window.getContentBounds()
    const isIn = (n: unknown, max: number): n is number =>
      typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max
    if (!isIn(x, width) || !isIn(y, height)) {
      throw new Error('Expected integer coordinates inside the window')
    }
    return { x, y }
  }

  ipcMain.handle(IpcChannel.Navigate, (event, input: unknown) => {
    const { tabs } = assertTrustedSender(event)
    if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) {
      throw new Error('navigate: input must be a string')
    }
    tabs.active.navigate(input)
  })

  ipcMain.handle(IpcChannel.Back, (event) => assertTrustedSender(event).tabs.active.back())
  ipcMain.handle(IpcChannel.Forward, (event) => assertTrustedSender(event).tabs.active.forward())
  ipcMain.handle(IpcChannel.Reload, (event) => assertTrustedSender(event).tabs.active.reload())
  ipcMain.handle(IpcChannel.Stop, (event) => assertTrustedSender(event).tabs.active.stop())
  ipcMain.handle(IpcChannel.Home, (event) => assertTrustedSender(event).tabs.active.goHome())

  ipcMain.handle(IpcChannel.NewTab, (event) => {
    assertTrustedSender(event).newTab()
  })
  ipcMain.handle(IpcChannel.CloseTab, (event, id: unknown) => {
    const main = assertTrustedSender(event)
    main.tabs.close(assertTabId(main, id))
  })
  ipcMain.handle(IpcChannel.ActivateTab, (event, id: unknown) => {
    const main = assertTrustedSender(event)
    main.tabs.activate(assertTabId(main, id))
  })
  ipcMain.handle(IpcChannel.ReopenClosedTab, (event) =>
    assertTrustedSender(event).tabs.reopenClosed()
  )
  ipcMain.handle(IpcChannel.ToggleMute, (event, id: unknown) => {
    const main = assertTrustedSender(event)
    main.tabs.toggleMute(assertTabId(main, id))
  })

  ipcMain.handle(IpcChannel.ResetZoom, (event) =>
    assertTrustedSender(event).tabs.active.resetZoom()
  )

  ipcMain.handle(IpcChannel.Find, (event, query: unknown) => {
    const { tabs } = assertTrustedSender(event)
    if (typeof query !== 'string' || query.length > MAX_FIND_LENGTH) {
      throw new Error('find: query must be a string')
    }
    tabs.active.findText(query)
  })
  ipcMain.handle(IpcChannel.FindNext, (event, forward: unknown) => {
    const { tabs } = assertTrustedSender(event)
    if (typeof forward !== 'boolean') throw new Error('findNext: forward must be a boolean')
    tabs.active.findAgain(forward)
  })
  ipcMain.handle(IpcChannel.CloseFind, (event) =>
    assertTrustedSender(event).tabs.active.closeFind()
  )

  ipcMain.handle(IpcChannel.ShowDownloadsMenu, (event, x: unknown, y: unknown) => {
    const main = assertTrustedSender(event)
    const point = assertPoint(main, x, y)
    showDownloadsMenu(main.window, main.downloads, point.x, point.y)
  })

  ipcMain.handle(IpcChannel.ToggleBookmark, (event) => {
    const { tabs, bookmarks } = assertTrustedSender(event)
    bookmarks.toggleTab(tabs.active)
  })
  ipcMain.handle(IpcChannel.OpenBookmark, (event, id: unknown, disposition: unknown) => {
    const main = assertTrustedSender(event)
    const bookmark = assertBookmark(main, id)
    if (!isDisposition(disposition)) throw new Error('openBookmark: unknown disposition')
    openBookmark(main.tabs, bookmark, disposition)
  })
  ipcMain.handle(IpcChannel.ShowBookmarkMenu, (event, id: unknown, x: unknown, y: unknown) => {
    const main = assertTrustedSender(event)
    const bookmark = id === null ? null : assertBookmark(main, id)
    const point = assertPoint(main, x, y)
    showBookmarkMenu(main, bookmark, point.x, point.y)
  })
  ipcMain.handle(
    IpcChannel.ShowBookmarksOverflow,
    (event, from: unknown, x: unknown, y: unknown) => {
      const main = assertTrustedSender(event)
      const count = main.bookmarks.all.length
      if (typeof from !== 'number' || !Number.isInteger(from) || from < 0 || from > count) {
        throw new Error('showBookmarksOverflow: expected an index into the bookmarks')
      }
      const point = assertPoint(main, x, y)
      showBookmarksOverflow(main, from, point.x, point.y)
    }
  )

  ipcMain.handle(IpcChannel.ShowAdblockMenu, (event, x: unknown, y: unknown) => {
    const main = assertTrustedSender(event)
    const point = assertPoint(main, x, y)
    showAdblockMenu(main, point.x, point.y)
  })

  ipcMain.handle(IpcChannel.ShowAgentMenu, (event, x: unknown, y: unknown) => {
    const main = assertTrustedSender(event)
    const point = assertPoint(main, x, y)
    showAgentMenu(main, point.x, point.y)
  })
  ipcMain.handle(IpcChannel.StopAgent, (event, id: unknown) => {
    const main = assertTrustedSender(event)
    main.agent.stop(assertTabId(main, id))
  })
  ipcMain.handle(IpcChannel.ResetEmulation, (event, id: unknown) => {
    const main = assertTrustedSender(event)
    return main.agent.resetEmulation(assertTabId(main, id))
  })

  /** Throws unless `id` is the id of a terminal in the panel. */
  const assertTerminalId = (main: MainWindow, id: unknown): number => {
    if (!isId(id) || !main.terminals.get(id)) throw new Error('Expected the id of a terminal')
    return id
  }

  ipcMain.handle(IpcChannel.ToggleTerminal, (event) =>
    assertTrustedSender(event).terminals.toggle()
  )
  ipcMain.handle(IpcChannel.NewTerminal, (event) => assertTrustedSender(event).terminals.create())
  ipcMain.handle(IpcChannel.CloseTerminal, (event, id: unknown) => {
    const main = assertTrustedSender(event)
    main.terminals.close(assertTerminalId(main, id))
  })
  ipcMain.handle(IpcChannel.SelectTerminal, (event, id: unknown) => {
    const main = assertTrustedSender(event)
    main.terminals.select(assertTerminalId(main, id))
  })
  ipcMain.handle(IpcChannel.SetTerminalHeight, (event, px: unknown) => {
    const main = assertTrustedSender(event)
    if (
      typeof px !== 'number' ||
      !Number.isInteger(px) ||
      px < 0 ||
      px > MAX_TERMINAL_HEIGHT_INPUT
    ) {
      throw new Error('setTerminalHeight: expected a height in px')
    }
    const { height } = main.window.getContentBounds()
    main.terminals.setHeight(clampTerminalHeight(px, height, main.tabs.uiHeight))
  })
  ipcMain.handle(IpcChannel.AttachTerminal, (event, id: unknown) => {
    const main = assertTrustedSender(event)
    main.terminals.attach(assertTerminalId(main, id))
  })
  ipcMain.handle(IpcChannel.StartAgentInTerminal, async (event, id: unknown) => {
    const main = assertTrustedSender(event)
    await main.terminals.startAgent(assertTerminalId(main, id))
  })
  ipcMain.handle(IpcChannel.ChooseTerminalFolder, async (event) => {
    await assertTrustedSender(event).terminals.chooseFolder()
  })

  /**
   * The terminal view's messages (sent, not invoked): null unless they came from the main
   * window's terminal view, top frame, on its trusted URL. Never throws: a throw in a listener
   * would be an uncaught exception in main.
   */
  const terminalSender = (event: IpcMainEvent): MainWindow | null => {
    const main = getMain()
    const frame = event.senderFrame
    if (
      !main ||
      main.window.isDestroyed() ||
      event.sender !== main.terminals.view.webContents ||
      !frame ||
      frame.parent !== null ||
      !isTrustedRendererUrl(frame.url, 'terminal.html')
    ) {
      console.error(`Rejected terminal IPC from untrusted sender: ${frame?.url ?? 'unknown'}`)
      return null
    }
    return main
  }

  ipcMain.on(TerminalViewChannel.Input, (event, id: unknown, data: unknown) => {
    const main = terminalSender(event)
    if (main && isId(id) && typeof data === 'string' && data.length <= MAX_TERMINAL_INPUT) {
      main.terminals.input(id, data)
    }
  })
  ipcMain.on(TerminalViewChannel.Resize, (event, id: unknown, cols: unknown, rows: unknown) => {
    const main = terminalSender(event)
    if (main && isId(id) && isTerminalSize(cols, rows)) {
      main.terminals.resize(id, cols as number, rows as number)
    }
  })
  ipcMain.on(TerminalViewChannel.Copy, (event, text: unknown) => {
    if (terminalSender(event) && typeof text === 'string' && text.length <= MAX_COPY_LENGTH) {
      clipboard.writeText(text)
    }
  })
  ipcMain.on(TerminalViewChannel.OpenLink, (event, id: unknown, url: unknown) => {
    const main = terminalSender(event)
    if (main && isId(id) && typeof url === 'string' && url.length <= MAX_LINK_LENGTH) {
      main.terminals.openLink(id, url)
    }
  })
  ipcMain.on(TerminalViewChannel.Ready, (event) => terminalSender(event)?.terminals.viewLoaded())

  ipcMain.handle(IpcChannel.SetChromeHeight, (event, px: unknown) => {
    const { tabs } = assertTrustedSender(event)
    if (typeof px !== 'number' || !Number.isInteger(px) || px < 0 || px > MAX_CHROME_HEIGHT) {
      throw new Error(`setChromeHeight: expected an integer from 0 to ${MAX_CHROME_HEIGHT}`)
    }
    tabs.setChromeHeight(px)
  })

  ipcMain.handle(IpcChannel.GetState, (event) => assertTrustedSender(event).getState())
}
