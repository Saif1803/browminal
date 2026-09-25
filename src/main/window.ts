import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { overallProgress } from '../shared/downloads'
import { TAB_STRIP_HEIGHT } from '../shared/layout'
import { IpcChannel, type BrowserState } from '../shared/types'
import type { Adblock } from './adblock'
import type { Bookmarks } from './bookmarks'
import type { Downloads } from './downloads'
import { TabManager } from './tab-manager'
import { onThemeChange, themeColors } from './theme'

const APP_NAME = 'Nebula'
// macOS traffic lights are about 14px tall; centre them in the tab strip.
const TRAFFIC_LIGHT_Y = Math.round((TAB_STRIP_HEIGHT - 14) / 2)

export interface MainWindow {
  window: BrowserWindow
  tabs: TabManager
  downloads: Downloads
  bookmarks: Bookmarks
  adblock: Adblock
  getState(): BrowserState
}

export function createMainWindow(
  downloads: Downloads,
  bookmarks: Bookmarks,
  adblock: Adblock
): MainWindow {
  const isMac = process.platform === 'darwin'
  const colors = themeColors()

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: APP_NAME,
    backgroundColor: colors.strip,
    titleBarStyle: 'hidden',
    // macOS: keep the traffic lights, vertically centred in the tab strip.
    ...(isMac ? { trafficLightPosition: { x: 14, y: TRAFFIC_LIGHT_Y } } : {}),
    // Windows/Linux: native min/max/close drawn over the right end of the tab strip.
    ...(!isMac
      ? {
          titleBarOverlay: {
            color: colors.strip,
            symbolColor: colors.symbol,
            height: TAB_STRIP_HEIGHT
          }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const ui = window.webContents
  // The UI never opens windows or navigates away from itself.
  ui.setWindowOpenHandler(() => ({ action: 'deny' }))
  ui.on('will-navigate', (event) => event.preventDefault())
  // The window title follows the page, not the UI's <title>.
  window.on('page-title-updated', (event) => event.preventDefault())

  const tabs = new TabManager(window)

  // The OS switched between light and dark: the UI and pages follow through CSS; the native
  // window controls and the window background are ours to repaint.
  const stopWatchingTheme = onThemeChange(() => {
    if (window.isDestroyed()) return
    const { strip, symbol } = themeColors()
    window.setBackgroundColor(strip)
    if (!isMac) window.setTitleBarOverlay({ color: strip, symbolColor: symbol })
  })

  const layout = (): void => tabs.layout()
  window.on('resize', layout)
  // Maximize/restore/fullscreen can change the content size without a matching resize on some platforms.
  window.on('maximize', layout)
  window.on('unmaximize', layout)
  window.on('enter-full-screen', layout)
  window.on('leave-full-screen', () => {
    tabs.windowLeftFullscreen()
    layout()
  })

  const getState = (): BrowserState => {
    const { tabs: tabSummaries, active } = tabs.getState()
    return {
      tabs: tabSummaries,
      active: {
        ...active,
        isBookmarked: bookmarks.isBookmarked(active.url),
        shield: adblock.shieldFor(active.url, tabs.active.webContents)
      },
      downloads: downloads.getState(),
      bookmarks: [...bookmarks.all],
      bookmarksBarVisible: bookmarks.barVisible
    }
  }

  // Changes come in bursts (loading, download progress): push at most one state per tick.
  let pushScheduled = false
  let taskbarProgress = -1
  const push = (): void => {
    pushScheduled = false
    if (window.isDestroyed()) return
    const state = getState()
    const { title } = state.active
    window.setTitle(title ? `${title} - ${APP_NAME}` : APP_NAME)
    // Download progress on the taskbar / Dock icon: over 1 means indeterminate, -1 hides it.
    const progress = overallProgress(state.downloads)
    const bar = progress === null ? -1 : progress === 'indeterminate' ? 2 : progress
    if (bar !== taskbarProgress) {
      taskbarProgress = bar
      window.setProgressBar(bar)
    }
    if (!ui.isDestroyed()) ui.send(IpcChannel.State, state)
  }
  const schedulePush = (): void => {
    if (pushScheduled) return
    pushScheduled = true
    setImmediate(push)
  }
  tabs.onChange(schedulePush)
  const stopWatchingDownloads = downloads.onChange(schedulePush)
  const stopWatchingBookmarks = bookmarks.onChange(schedulePush)
  const stopWatchingAdblock = adblock.onChange(schedulePush)
  tabs.onTabCreated((tab) => adblock.attach(tab.webContents))
  // Visiting a bookmarked page refreshes the bookmark's icon.
  tabs.onFaviconLoaded((url, favicon) => bookmarks.updateFavicon(url, favicon))

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    stopWatchingDownloads()
    stopWatchingBookmarks()
    stopWatchingAdblock()
    stopWatchingTheme()
    tabs.dispose()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return { window, tabs, downloads, bookmarks, adblock, getState }
}
