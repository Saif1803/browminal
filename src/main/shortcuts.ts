import type { Input, WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IpcChannel } from '../shared/types'
import type { MainWindow } from './window'

const isMac = process.platform === 'darwin'

function isModOnly(input: Input): boolean {
  const mod = isMac ? input.meta : input.control
  const otherMod = isMac ? input.control : input.meta
  return mod && !otherMod && !input.alt && !input.shift
}

/**
 * Window-level shortcuts. They're caught with before-input-event on both the UI and
 * the tab so they work wherever focus is, and so Ctrl+R never reloads the UI itself.
 */
export function registerShortcuts({ window, tab }: MainWindow): void {
  const handle = (event: Electron.Event, input: Input): void => {
    if (input.type !== 'keyDown') return

    // Dev only: F12 opens DevTools for the UI renderer (there's no menu to do it from).
    if (is.dev && input.key === 'F12') {
      event.preventDefault()
      window.webContents.toggleDevTools()
      return
    }

    if (!isModOnly(input)) return
    const key = input.key.toLowerCase()

    if (key === 'l') {
      event.preventDefault()
      window.webContents.focus()
      window.webContents.send(IpcChannel.FocusAddressBar)
    } else if (key === 'r') {
      event.preventDefault()
      tab.reload()
    }
  }

  const attach = (wc: WebContents): void => {
    wc.on('before-input-event', handle)
  }
  attach(window.webContents)
  attach(tab.webContents)
}
