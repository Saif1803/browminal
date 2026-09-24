import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
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

  ipcMain.handle(IpcChannel.Navigate, (event, input: unknown) => {
    const { tab } = assertTrustedSender(event)
    if (typeof input !== 'string' || input.length > MAX_INPUT_LENGTH) {
      throw new Error('navigate: input must be a string')
    }
    tab.navigate(input)
  })

  ipcMain.handle(IpcChannel.Back, (event) => assertTrustedSender(event).tab.back())
  ipcMain.handle(IpcChannel.Forward, (event) => assertTrustedSender(event).tab.forward())
  ipcMain.handle(IpcChannel.Reload, (event) => assertTrustedSender(event).tab.reload())
  ipcMain.handle(IpcChannel.Stop, (event) => assertTrustedSender(event).tab.stop())
  ipcMain.handle(IpcChannel.Home, (event) => assertTrustedSender(event).tab.goHome())
  ipcMain.handle(IpcChannel.GetState, (event) => assertTrustedSender(event).tab.getState())
}
