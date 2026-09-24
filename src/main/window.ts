import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IpcChannel } from '../shared/types'
import { Tab } from './tabs'

/** Height of the React top bar; the tab view is placed directly below it. */
export const TOOLBAR_HEIGHT = 44

const APP_NAME = 'Nebula'
const TOOLBAR_COLOR = '#15131f'
const SYMBOL_COLOR = '#c9c5dc'

export interface MainWindow {
  window: BrowserWindow
  tab: Tab
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
    backgroundColor: TOOLBAR_COLOR,
    titleBarStyle: 'hidden',
    // macOS: keep the traffic lights, vertically centred in the top bar.
    ...(isMac ? { trafficLightPosition: { x: 14, y: 15 } } : {}),
    // Windows/Linux: native min/max/close drawn over the right end of the top bar.
    ...(!isMac
      ? {
          titleBarOverlay: {
            color: TOOLBAR_COLOR,
            symbolColor: SYMBOL_COLOR,
            height: TOOLBAR_HEIGHT
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

  const tab = new Tab()
  window.contentView.addChildView(tab.view)

  const layout = (): void => {
    const { width, height } = window.getContentBounds()
    tab.setBounds({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width,
      height: Math.max(0, height - TOOLBAR_HEIGHT)
    })
  }
  layout()
  window.on('resize', layout)
  // Maximize/restore/fullscreen can change the content size without a matching resize on some platforms.
  window.on('maximize', layout)
  window.on('unmaximize', layout)
  window.on('enter-full-screen', layout)
  window.on('leave-full-screen', layout)

  tab.onStateChange((state) => {
    window.setTitle(state.title ? `${state.title} - ${APP_NAME}` : APP_NAME)
    if (!ui.isDestroyed()) ui.send(IpcChannel.TabState, state)
  })

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => tab.destroy())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  tab.goHome()

  return { window, tab }
}
