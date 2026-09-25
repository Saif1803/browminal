import { dialog, shell, type BrowserWindow } from 'electron'
import { decideNavigation } from './navigation-policy'

const APP_NAMES: Record<string, string> = {
  'mailto:': 'your email app',
  'tel:': 'an app for phone calls'
}

// One question at a time, so a page can't stack up dialogs.
let isAsking = false

/**
 * Asks before handing a mailto:/tel: link from `pageUrl` to the operating system.
 * Every other scheme is ignored.
 */
export async function confirmOpenExternal(
  window: BrowserWindow,
  pageUrl: string,
  url: string
): Promise<void> {
  if (isAsking || window.isDestroyed() || decideNavigation(url) !== 'external') return
  const appName = APP_NAMES[new URL(url).protocol]
  if (!appName) return

  isAsking = true
  try {
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      title: 'Open link',
      message: `${siteName(pageUrl)} wants to open ${appName}`,
      detail: url.length > 300 ? `${url.slice(0, 300)}…` : url,
      buttons: ['Open', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (response === 0) await shell.openExternal(url)
  } catch {
    // No app handles the link; nothing else to do.
  } finally {
    isAsking = false
  }
}

function siteName(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname || 'This page'
  } catch {
    return 'This page'
  }
}
