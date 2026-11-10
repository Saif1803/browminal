import type { ShieldState } from '../shared/types'
import type { MenuEntry } from './menu-model'
import type { MainWindow } from './window'

function describe({ status, site, blocked }: ShieldState): string {
  switch (status) {
    case 'on':
      if (blocked === 0) return 'Nothing blocked on this page'
      return blocked === 1 ? '1 ad or tracker blocked' : `${blocked} ads and trackers blocked`
    case 'paused':
      return `Paused on ${site}`
    case 'off':
      return 'Ad blocker is off'
    case 'loading':
      return 'Downloading filter lists…'
    case 'unavailable':
      return "Filter lists couldn't be downloaded"
  }
}

/**
 * The shield's menu for the active tab (an overlay menu): pause on this site, turn off everywhere.
 * The page reloads after either, so it shows the change.
 */
export function showAdblockMenu(main: MainWindow, x: number, y: number): void {
  const { window, tabs, adblock, overlay } = main
  const tab = tabs.active
  const shield = adblock.shieldFor(tab.url, tab.webContents)
  if (!shield || window.isDestroyed()) return

  const template: MenuEntry[] = [
    { label: describe(shield) },
    { type: 'separator' },
    {
      label: `Block ads on ${shield.site}`,
      checked: shield.status !== 'paused',
      enabled: adblock.enabled,
      click: () => {
        adblock.togglePaused(shield.site)
        tab.reload()
      }
    },
    {
      label: 'Block ads and trackers everywhere',
      checked: adblock.enabled,
      click: () => {
        adblock.setEnabled(!adblock.enabled)
        tab.reload()
      }
    }
  ]
  if (shield.status === 'unavailable') {
    template.push({ type: 'separator' }, { label: 'Try again', click: () => adblock.retry() })
  }
  overlay.showMenu(template, x, y, {
    at: 'anchor',
    width: 300,
    returnTo: window.webContents,
    toggle: 'shield'
  })
}
