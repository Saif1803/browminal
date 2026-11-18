import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { overallProgress } from '../shared/downloads'
import { TAB_STRIP_HEIGHT } from '../shared/layout'
import { GLASS_SWITCH, IpcChannel, type BrowserState } from '../shared/types'
import type { Adblock } from './adblock'
import type { Agent } from './agent'
import type { Bookmarks } from './bookmarks'
import type { Downloads } from './downloads'
import { confirmOpenExternal } from './external-links'
import { Overlay } from './overlay'
import type { Settings } from './settings'
import type { JsonStore } from './store'
import { TabManager } from './tab-manager'
import { Terminals } from './terminals'
import { GLASS_MATERIAL, onThemeChange, themeColors } from './theme'

const APP_NAME = 'Browminal'
// macOS traffic lights are about 14px tall; centre them in the tab strip.
const TRAFFIC_LIGHT_Y = Math.round((TAB_STRIP_HEIGHT - 14) / 2)

export interface MainWindow {
  window: BrowserWindow
  tabs: TabManager
  downloads: Downloads
  bookmarks: Bookmarks
  adblock: Adblock
  agent: Agent
  terminals: Terminals
  /** Popovers over the page: the agent sheet, the errors popover, questions for the user. */
  overlay: Overlay
  getState(): BrowserState
  /** Puts the keyboard in the active tab's address bar. */
  focusAddressBar(): void
  /** Ctrl+T, the + button: a new tab, ready to type an address into. */
  newTab(): void
}

export function createMainWindow(
  downloads: Downloads,
  bookmarks: Bookmarks,
  adblock: Adblock,
  agent: Agent,
  settings: JsonStore<Settings>,
  userData: string
): MainWindow {
  const isMac = process.platform === 'darwin'
  const colors = themeColors()
  const material = GLASS_MATERIAL
  // With a glass material the window is see-through: the OS draws the frosted backdrop and the
  // UI paints translucent colours over it. Without one, the tab strip colour fills the window.
  const background = (): string => (material ? '#00000000' : themeColors().strip)

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: APP_NAME,
    backgroundColor: background(),
    ...(material === 'acrylic' ? { backgroundMaterial: 'acrylic' as const } : {}),
    ...(material === 'vibrancy'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'followWindow' as const }
      : {}),
    titleBarStyle: 'hidden',
    // macOS: keep the traffic lights, vertically centred in the tab strip.
    ...(isMac ? { trafficLightPosition: { x: 14, y: TRAFFIC_LIGHT_Y } } : {}),
    // Windows/Linux: native min/max/close drawn over the right end of the tab strip.
    ...(!isMac
      ? {
          titleBarOverlay: {
            color: background(),
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
      nodeIntegration: false,
      additionalArguments: material ? [GLASS_SWITCH] : []
    }
  })

  const ui = window.webContents
  // The UI never opens windows or navigates away from itself.
  ui.setWindowOpenHandler(() => ({ action: 'deny' }))
  ui.on('will-navigate', (event) => event.preventDefault())
  // The window title follows the page, not the UI's <title>.
  window.on('page-title-updated', (event) => event.preventDefault())

  const tabs = new TabManager(window)
  const terminals = new Terminals(window, tabs, settings, agent, userData)
  // After the terminal, so it's placed (and kept) above the terminal view.
  const overlay = new Overlay(window, tabs, agent)
  tabs.onOpenExternal((tab, url) => void confirmOpenExternal(overlay, tab.id, tab.url, url))

  // The OS switched between light and dark: the UI and pages follow through CSS; the native
  // window controls and the window background are ours to repaint.
  const stopWatchingTheme = onThemeChange(() => {
    if (window.isDestroyed()) return
    window.setBackgroundColor(background())
    if (!isMac)
      window.setTitleBarOverlay({ color: background(), symbolColor: themeColors().symbol })
  })

  const layout = (): void => tabs.layout()
  window.on('resize', () => {
    overlay.windowResized()
    layout()
  })
  // Back in front: pages agents worked on while it was away go back to normal, and pages lay
  // out for the window's real size again (they keep their size while it's minimized).
  window.on('restore', () => {
    agent.windowShown()
    layout()
  })
  window.on('show', () => agent.windowShown())
  window.on('focus', () => agent.windowShown())
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
      tabs: tabSummaries.map((tab) => ({ ...tab, agentShared: agent.isShared(tab.id) })),
      active: {
        ...active,
        isBookmarked: bookmarks.isBookmarked(active.url),
        shield: adblock.shieldFor(active.url, tabs.active.webContents),
        emulation: agent.emulationOf(active.id),
        errors: agent.errorsOf(active.id)
      },
      downloads: downloads.getState(),
      bookmarks: [...bookmarks.all],
      bookmarksBarVisible: bookmarks.barVisible,
      agent: agent.getState(),
      terminal: terminals.getState(),
      overlay: overlay.kind
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
    overlay.refresh()
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
  const stopWatchingAgent = agent.onChange(schedulePush)
  terminals.onChange(schedulePush)
  overlay.onChange(schedulePush)
  tabs.onTabCreated((tab) => {
    adblock.attach(tab.webContents)
    agent.watchTab(tab)
  })
  // Visiting a bookmarked page refreshes the bookmark's icon.
  tabs.onFaviconLoaded((url, favicon) => bookmarks.updateFavicon(url, favicon))

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    stopWatchingDownloads()
    stopWatchingBookmarks()
    stopWatchingAdblock()
    stopWatchingAgent()
    stopWatchingTheme()
    overlay.dispose()
    terminals.dispose()
    tabs.dispose()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const focusAddressBar = (): void => {
    if (ui.isDestroyed()) return
    // After the tab's own focus (activate, the home page's prompt box), so the UI keeps it.
    ui.focus()
    ui.send(IpcChannel.FocusAddressBar, tabs.active.id)
  }
  const newTab = (): void => {
    tabs.create()
    focusAddressBar()
  }

  return {
    window,
    tabs,
    downloads,
    bookmarks,
    adblock,
    agent,
    terminals,
    overlay,
    getState,
    focusAddressBar,
    newTab
  }
}
