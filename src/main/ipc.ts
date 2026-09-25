import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { MAX_CHROME_HEIGHT } from '../shared/layout'
import { IpcChannel, type Bookmark, type OpenDisposition } from '../shared/types'
import { showAdblockMenu } from './adblock-menu'
import { openBookmark } from './bookmarks'
import { showBookmarkMenu, showBookmarksOverflow } from './bookmarks-menu'
import { showDownloadsMenu } from './downloads-menu'
import type { MainWindow } from './window'

const MAX_INPUT_LENGTH = 8192
const MAX_FIND_LENGTH = 1000

const isDisposition = (value: unknown): value is OpenDisposition =>
  value === 'current' || value === 'foreground' || value === 'background'

/**
 * The URL the UI renderer is served from. Every IPC message must come from a
 * top-level frame on this origin (dev server) or this exact file (packaged).
 */
function isTrustedUiUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    try {
      return new URL(url).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  const indexUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href
  return url.split(/[?#]/)[0] === indexUrl
}

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
      !isTrustedUiUrl(frame.url)
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
    assertTrustedSender(event).tabs.create()
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

  ipcMain.handle(IpcChannel.SetChromeHeight, (event, px: unknown) => {
    const { tabs } = assertTrustedSender(event)
    if (typeof px !== 'number' || !Number.isInteger(px) || px < 0 || px > MAX_CHROME_HEIGHT) {
      throw new Error(`setChromeHeight: expected an integer from 0 to ${MAX_CHROME_HEIGHT}`)
    }
    tabs.setChromeHeight(px)
  })

  ipcMain.handle(IpcChannel.GetState, (event) => assertTrustedSender(event).getState())
}
