import type { Input, WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IpcChannel } from '../shared/types'
import { commandForInput, isRepeatable, type Command } from './shortcut-map'
import type { MainWindow } from './window'

const platform = process.platform === 'darwin' ? 'mac' : 'other'

/**
 * Browser shortcuts (see shortcut-map.ts). They're caught with before-input-event on the UI
 * and on every tab so they work wherever focus is, before the page or the UI sees the key.
 * Also handles the mouse's back/forward buttons (Windows, Linux) and swipes (macOS).
 */
export function registerShortcuts({ window, tabs }: MainWindow): void {
  const ui = window.webContents

  const focusUi = (channel: string): void => {
    ui.focus()
    ui.send(channel)
  }

  const run = (command: Command): void => {
    const tab = tabs.active
    switch (command.type) {
      case 'newTab':
        return void tabs.create()
      case 'closeTab':
        return tabs.close(tab.id)
      case 'reopenTab':
        return tabs.reopenClosed()
      case 'nextTab':
        return tabs.activateRelative(1)
      case 'previousTab':
        return tabs.activateRelative(-1)
      case 'selectTab':
        return tabs.activateIndex(command.index)
      case 'selectLastTab':
        return tabs.activateIndex(tabs.all.length - 1)
      case 'focusAddressBar':
        return focusUi(IpcChannel.FocusAddressBar)
      case 'reload':
        return tab.reload()
      case 'hardReload':
        return tab.reload(true)
      case 'stop':
        return tab.stop()
      case 'back':
        return tab.back()
      case 'forward':
        return tab.forward()
      case 'home':
        return tab.goHome()
      case 'find':
        tab.openFind()
        return focusUi(IpcChannel.FocusFind)
      case 'findNext':
      case 'findPrevious':
        if (tab.isFindOpen()) return tab.findAgain(command.type === 'findNext')
        tab.openFind()
        return focusUi(IpcChannel.FocusFind)
      case 'print':
        return tab.print()
      case 'zoomIn':
        return tab.zoom('in')
      case 'zoomOut':
        return tab.zoom('out')
      case 'zoomReset':
        return tab.resetZoom()
      case 'toggleFullscreen':
        return window.setFullScreen(!window.isFullScreen())
      case 'toggleDevTools':
        return tab.toggleDevTools()
    }
  }

  const handle = (from: WebContents) => (event: Electron.Event, input: Input) => {
    if (input.type !== 'keyDown') return

    // Dev only: Shift+F12 opens DevTools for the UI renderer (F12 is the page's).
    if (is.dev && input.key === 'F12' && input.shift && !input.control && !input.meta) {
      event.preventDefault()
      ui.toggleDevTools()
      return
    }

    const command = commandForInput(input, platform)
    if (!command) return

    // Esc belongs to the UI (address bar, find bar) and to the page, unless it has
    // something to stop: a fullscreen page, or a page that's loading.
    if (command.type === 'stop') {
      if (from === ui) return
      if (tabs.exitPageFullscreen()) return void event.preventDefault()
      if (!tabs.active.webContents.isLoading()) return
    }

    event.preventDefault()
    if (input.isAutoRepeat && !isRepeatable(command)) return
    run(command)
  }

  const attach = (wc: WebContents): void => {
    wc.on('before-input-event', handle(wc))
  }
  attach(ui)
  tabs.onTabCreated((tab) => attach(tab.webContents))

  // Mouse buttons 4/5.
  window.on('app-command', (_event, command) => {
    if (command === 'browser-backward') tabs.active.back()
    else if (command === 'browser-forward') tabs.active.forward()
  })
  // macOS three-finger swipe (when the trackpad is set to swipe between pages with three fingers).
  window.on('swipe', (_event, direction) => {
    if (direction === 'right') tabs.active.back()
    else if (direction === 'left') tabs.active.forward()
  })
}
