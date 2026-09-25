import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import { MAX_CHROME_HEIGHT } from '../shared/layout'
import { IpcChannel } from '../shared/types'
import type { MainWindow } from './window'

const MAX_INPUT_LENGTH = 8192

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

  ipcMain.handle(IpcChannel.SetChromeHeight, (event, px: unknown) => {
    const { tabs } = assertTrustedSender(event)
    if (typeof px !== 'number' || !Number.isInteger(px) || px < 0 || px > MAX_CHROME_HEIGHT) {
      throw new Error(`setChromeHeight: expected an integer from 0 to ${MAX_CHROME_HEIGHT}`)
    }
    tabs.setChromeHeight(px)
  })

  ipcMain.handle(IpcChannel.GetState, (event) => assertTrustedSender(event).tabs.getState())
}
