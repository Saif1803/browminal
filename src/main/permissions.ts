import {
  app,
  desktopCapturer,
  dialog,
  session,
  webContents,
  type BrowserWindow,
  type DesktopCapturerSource,
  type WebContents
} from 'electron'
import {
  PermissionMemory,
  checkFor,
  describeRequest,
  permissionOrigin,
  policyFor
} from './permission-policy'
import type { MainWindow } from './window'

/** Allow / Block for a permission. Enter and Esc both block. */
async function askAllow(window: BrowserWindow, message: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Permission request',
    message,
    detail: 'Nebula remembers your answer for this site until you close the browser.',
    buttons: ['Allow', 'Block'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  return response === 0
}

/** Which screen to share, or null. Screens only for now; audio is never shared. */
async function pickScreen(
  window: BrowserWindow,
  site: string,
  screens: DesktopCapturerSource[]
): Promise<DesktopCapturerSource | null> {
  if (screens.length === 0) return null
  const choices =
    screens.length === 1 ? ['Share screen'] : screens.map((screen) => `Share ${screen.name}`)
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Share your screen',
    message: `${site} wants to see your screen`,
    detail: 'The site sees everything on the screen you share until you stop sharing.',
    buttons: [...choices, 'Cancel'],
    defaultId: choices.length,
    cancelId: choices.length,
    noLink: true
  })
  return screens[response] ?? null
}

/**
 * Permissions for web pages (Electron grants everything by default). See permission-policy.ts
 * for what's allowed, asked or denied. Only the active tab can ask; answers last for the session.
 * The UI and nebula:// pages never get anything, and pages can't pick USB, HID, serial or
 * Bluetooth devices.
 */
export function registerPermissions(getMain: () => MainWindow | null): void {
  const ses = session.defaultSession
  const memory = new PermissionMemory()

  // One dialog at a time; queued requests then see the earlier answer.
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (prompt: () => Promise<void>): void => {
    queue = queue.then(prompt).catch(() => {})
  }

  const isTab = (wc: WebContents): boolean =>
    getMain()?.tabs.all.some((tab) => tab.webContents === wc) ?? false

  /** The window to prompt on, only if `wc` is the tab in front; background tabs can't ask. */
  const promptWindow = (wc: WebContents): BrowserWindow | null => {
    const main = getMain()
    if (!main || main.window.isDestroyed() || main.tabs.active.webContents !== wc) return null
    return main.window
  }

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = permissionOrigin(details.requestingUrl)
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    const policy = policyFor(permission, mediaTypes)
    if (!origin || !isTab(wc) || policy.action === 'deny') return callback(false)
    if (policy.action === 'allow') return callback(true)

    const known = memory.decide(origin, policy.kinds)
    if (known !== undefined) return callback(known)
    const window = promptWindow(wc)
    // Refused without remembering, so the site can ask again from the front.
    if (!window) return callback(false)

    enqueue(async () => {
      const answered = memory.decide(origin, policy.kinds)
      if (answered !== undefined) return callback(answered)
      // The tab may have closed or left the site while an earlier dialog was open.
      const stillThere =
        !wc.isDestroyed() && (!details.isMainFrame || permissionOrigin(wc.getURL()) === origin)
      if (window.isDestroyed() || !stillThere) return callback(false)

      const kinds = memory.unanswered(origin, policy.kinds)
      const allowed = await askAllow(window, describeRequest(new URL(origin).host, kinds))
      memory.remember(origin, kinds, allowed)
      callback(allowed)
    })
  })

  // Checks (navigator.permissions.query, showing a notification) never prompt. There's no
  // "ask" answer, so anything not yet allowed reads as denied until the site requests it.
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    // No webContents means a service worker (push notifications); the site's answers still apply.
    if (wc && !isTab(wc)) return false
    const origin = permissionOrigin(requestingOrigin)
    if (!origin) return false
    const check = checkFor(permission, details.mediaType)
    if (check === 'allow' || check === 'deny') return check === 'allow'
    return memory.get(origin, check) === true
  })

  // Screen sharing (getDisplayMedia) asks every time, like other browsers.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const deny = (): void => callback({})
    const wc = request.frame ? webContents.fromFrame(request.frame) : undefined
    const origin = permissionOrigin(request.securityOrigin)
    const window = wc && isTab(wc) ? promptWindow(wc) : null
    if (!wc || !window || !origin || !request.userGesture) return deny()

    enqueue(async () => {
      if (window.isDestroyed() || wc.isDestroyed()) return deny()
      const screens = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 }
      })
      const screen = await pickScreen(window, new URL(origin).host, screens)
      if (screen && !wc.isDestroyed()) callback({ video: screen })
      else deny()
    })
  })

  // USB, HID, serial and Bluetooth: no device is ever handed to a page. Without these handlers
  // Electron would pick the first Bluetooth device on its own.
  ses.setDevicePermissionHandler(() => false)
  ses.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
  ses.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
  ses.on('select-serial-port', (event, _ports, _wc, callback) => {
    event.preventDefault()
    callback('')
  })
  app.on('web-contents-created', (_event, wc) => {
    wc.on('select-bluetooth-device', (event, _devices, callback) => {
      event.preventDefault()
      callback('')
    })
  })
}
