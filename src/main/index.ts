import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp } from '@electron-toolkit/utils'
import { Adblock } from './adblock'
import { Bookmarks } from './bookmarks'
import { registerContextMenus } from './context-menu'
import { Downloads } from './downloads'
import { registerIpc } from './ipc'
import { registerPermissions } from './permissions'
import { handleInternalProtocol, registerInternalScheme } from './protocol'
import { parseSettings } from './settings'
import { registerShortcuts } from './shortcuts'
import { JsonStore } from './store'
import { cleanUserAgent } from './user-agent'
import { createMainWindow, type MainWindow } from './window'

let main: MainWindow | null = null

registerInternalScheme()
// Look like plain Chrome, so sites (notably Google sign-in) don't block us as an embedded browser.
app.userAgentFallback = cleanUserAgent(app.userAgentFallback, app.getName())

function openWindow(downloads: Downloads, bookmarks: Bookmarks, adblock: Adblock): void {
  const opened = createMainWindow(downloads, bookmarks, adblock)
  main = opened
  registerShortcuts(opened)
  registerContextMenus(opened)
  // On Windows and Linux closing the window quits, so ask first if downloads are running.
  // (On macOS the app keeps running and downloading; quitting asks instead.)
  if (process.platform !== 'darwin') {
    opened.window.on('close', (event) => {
      if (!downloads.confirmQuit(opened.window)) event.preventDefault()
    })
  }
  opened.window.on('closed', () => {
    main = null
  })
}

/**
 * macOS needs an app menu for Quit and for copy/paste to work in inputs.
 * It intentionally has no View > Reload, so Cmd+R reloads the page (see shortcuts.ts), not the UI.
 * Other platforms get no menu at all.
 */
function setAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
  )
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.nebula.browser')
  setAppMenu()
  handleInternalProtocol()
  registerPermissions(() => main)
  const downloads = new Downloads(() => main)
  const userData = app.getPath('userData')
  const settings = new JsonStore(join(userData, 'settings.json'), { parse: parseSettings })
  const bookmarks = new Bookmarks(userData, settings)
  const adblock = new Adblock(userData, settings)
  registerIpc(() => main)
  openWindow(downloads, bookmarks, adblock)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow(downloads, bookmarks, adblock)
  })
  app.on('before-quit', (event) => {
    if (!downloads.confirmQuit(main?.window ?? null)) event.preventDefault()
  })
  app.on('will-quit', () => {
    downloads.cancelAll()
    bookmarks.flush()
    settings.flush()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
