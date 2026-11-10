import { shell } from 'electron'
import { decideNavigation } from './navigation-policy'
import type { Overlay } from './overlay'

const APP_NAMES: Record<string, string> = {
  'mailto:': 'your email app',
  'tel:': 'an app for phone calls'
}

const MAX_SHOWN_URL = 300

// One question at a time, so a page can't stack up questions.
let isAsking = false

/**
 * Asks before handing a mailto:/tel: link from tab `tabId` (on `pageUrl`) to the operating
 * system. Every other scheme is ignored. The question goes away if the tab leaves the front.
 */
export async function confirmOpenExternal(
  overlay: Overlay,
  tabId: number,
  pageUrl: string,
  url: string
): Promise<void> {
  if (isAsking || decideNavigation(url) !== 'external') return
  const appName = APP_NAMES[new URL(url).protocol]
  if (!appName) return

  isAsking = true
  try {
    const open = await overlay.ask(
      {
        icon: 'link',
        site: siteName(pageUrl),
        message: `wants to open ${appName}`,
        detail: null,
        code: url.length > MAX_SHOWN_URL ? `${url.slice(0, MAX_SHOWN_URL)}…` : url,
        fromAgent: false,
        confirm: new URL(url).protocol === 'mailto:' ? 'Open email app' : 'Open phone app',
        cancel: 'Cancel',
        destructive: false
      },
      tabId
    )
    if (open) await shell.openExternal(url)
  } catch {
    // No app handles the link; nothing else to do.
  } finally {
    isAsking = false
  }
}

function siteName(pageUrl: string): string {
  try {
    return new URL(pageUrl).host || 'This page'
  } catch {
    return 'This page'
  }
}
