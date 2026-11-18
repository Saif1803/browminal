import { app, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp } from '@electron-toolkit/utils'
import { Adblock } from './adblock'
import { Agent } from './agent'
import { Bookmarks } from './bookmarks'
import { registerContextMenus } from './context-menu'
import { Downloads } from './downloads'
import { registerIpc } from './ipc'
import { registerPermissions } from './permissions'
import { handleInternalProtocol, registerInternalScheme } from './protocol'
import { parseSettings, type Settings } from './settings'
import { Session } from './session'
import { registerShortcuts } from './shortcuts'
import { launchUrl } from './launch-args'
import { JsonStore } from './store'
import { cleanUserAgent } from './user-agent'
import { createMainWindow, type MainWindow } from './window'

let main: MainWindow | null = null

// One Browminal per profile: a second one would write the same settings, bookmarks and token files
// and compete for the bridge's port. A second launch hands its URL (if any) to this one and quits.
if (app.requestSingleInstanceLock()) {
  registerInternalScheme()
  // Look like plain Chrome, so sites (notably Google sign-in) don't block us as an embedded browser.
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback, app.getName())
  app.whenReady().then(startBrowser)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
} else {
  console.log('Browminal is already running with this profile; handed over to it.')
  app.quit()
}

function openWindow(
  downloads: Downloads,
  bookmarks: Bookmarks,
  adblock: Adblock,
  agent: Agent,
  settings: JsonStore<Settings>,
  session: Session
): void {
  const opened = createMainWindow(
    downloads,
    bookmarks,
    adblock,
    agent,
    settings,
    session,
    app.getPath('userData')
  )
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

function startBrowser(): void {
  electronApp.setAppUserModelId('com.browminal.browser')
  setAppMenu()
  handleInternalProtocol()
  registerPermissions(() => main)
  const downloads = new Downloads(() => main)
  const userData = app.getPath('userData')
  const settings = new JsonStore(join(userData, 'settings.json'), { parse: parseSettings })
  const bookmarks = new Bookmarks(userData, settings)
  const adblock = new Adblock(userData, settings)
  const agent = new Agent(userData, settings, () => main)
  const session = new Session(userData, settings)
  const restoring = session.toRestore() !== null
  registerIpc(() => main)
  const open = (): void => openWindow(downloads, bookmarks, adblock, agent, settings, session)
  open()
  // A page named on the command line: in the first tab, or after the tabs brought back.
  const firstUrl = launchUrl(process.argv)
  if (firstUrl && restoring) main?.tabs.create({ url: firstUrl })
  else if (firstUrl) main?.tabs.active.load(firstUrl)

  // Another launch of Browminal (it quits at once): show this window, and its URL in a new tab.
  app.on('second-instance', (_event, commandLine) => {
    if (!main) open()
    const opened = main
    if (!opened) return
    const url = launchUrl(commandLine)
    if (url) opened.tabs.create({ url })
    if (opened.window.isMinimized()) opened.window.restore()
    opened.window.show()
    opened.window.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) open()
  })
  app.on('before-quit', (event) => {
    if (!downloads.confirmQuit(main?.window ?? null)) event.preventDefault()
  })
  app.on('will-quit', () => {
    downloads.cancelAll()
    agent.dispose()
    bookmarks.flush()
    session.flush()
    settings.flush()
  })
}
