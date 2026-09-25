import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { ShieldState } from '../shared/types'
import { menuText } from './menu-text'
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
 * The shield's menu for the active tab: pause on this site, turn off everywhere. The page reloads
 * after either, so it shows the change. A placeholder until the design pass brings a panel.
 */
export function showAdblockMenu(main: MainWindow, x: number, y: number): void {
  const { window, tabs, adblock } = main
  const tab = tabs.active
  const shield = adblock.shieldFor(tab.url, tab.webContents)
  if (!shield || window.isDestroyed()) return

  const template: MenuItemConstructorOptions[] = [
    { label: menuText(describe(shield)), enabled: false },
    { type: 'separator' },
    {
      label: menuText(`Block ads on ${shield.site}`),
      type: 'checkbox',
      checked: shield.status !== 'paused',
      enabled: adblock.enabled,
      click: () => {
        adblock.togglePaused(shield.site)
        tab.reload()
      }
    },
    {
      label: 'Block ads and trackers everywhere',
      type: 'checkbox',
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
  Menu.buildFromTemplate(template).popup({ window, x, y })
}
