import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { TAB_STRIP_HEIGHT } from '../shared/layout'
import { IpcChannel } from '../shared/types'
import { TabManager } from './tab-manager'

const APP_NAME = 'Nebula'
// Matches --color-strip in the UI, which the native window controls sit on.
const STRIP_COLOR = '#0f0d17'
const SYMBOL_COLOR = '#c9c5dc'
// macOS traffic lights are about 14px tall; centre them in the tab strip.
const TRAFFIC_LIGHT_Y = Math.round((TAB_STRIP_HEIGHT - 14) / 2)

export interface MainWindow {
  window: BrowserWindow
  tabs: TabManager
}

export function createMainWindow(): MainWindow {
  const isMac = process.platform === 'darwin'

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: APP_NAME,
    backgroundColor: STRIP_COLOR,
    titleBarStyle: 'hidden',
    // macOS: keep the traffic lights, vertically centred in the tab strip.
    ...(isMac ? { trafficLightPosition: { x: 14, y: TRAFFIC_LIGHT_Y } } : {}),
    // Windows/Linux: native min/max/close drawn over the right end of the tab strip.
    ...(!isMac
      ? {
          titleBarOverlay: {
            color: STRIP_COLOR,
            symbolColor: SYMBOL_COLOR,
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

  tabs.onStateChange((state) => {
    const { title } = state.active
    window.setTitle(title ? `${title} - ${APP_NAME}` : APP_NAME)
    if (!ui.isDestroyed()) ui.send(IpcChannel.State, state)
  })

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => tabs.dispose())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return { window, tabs }
}
