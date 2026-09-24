import { app, BrowserWindow, Menu } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { registerShortcuts } from './shortcuts'
import { createMainWindow, type MainWindow } from './window'

let main: MainWindow | null = null

function openWindow(): void {
  main = createMainWindow()
  registerShortcuts(main)
  main.window.on('closed', () => {
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
  registerIpc(() => main)
  openWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
