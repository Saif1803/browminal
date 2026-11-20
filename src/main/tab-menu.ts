import type { MenuEntry } from './menu-model'
import { idsRightOf } from './tab-order'
import type { MainWindow } from './window'

const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl+'
const shiftMod = process.platform === 'darwin' ? '⇧⌘' : 'Ctrl+Shift+'

/** Right-click on a tab in the strip: an overlay menu at (x, y) in the window. */
export function showTabMenu(main: MainWindow, tabId: number, x: number, y: number): void {
  const { window, tabs, agent, overlay } = main
  const tab = tabs.get(tabId)
  if (!tab || window.isDestroyed()) return
  const isActive = tab === tabs.active
  // Shortcuts act on the tab in front, so they're only shown on its menu (Reopen acts on none).
  const shortcut = (keys: string): string | undefined => (isActive ? keys : undefined)
  const template: MenuEntry[] = [
    {
      label: 'New tab to the right',
      click: () => tabs.create({ index: tabs.all.indexOf(tab) + 1 })
    },
    { type: 'separator' },
    { label: 'Reload', shortcut: shortcut(`${mod}R`), click: () => tabs.reload(tabId) },
    { label: 'Duplicate', enabled: tabs.canDuplicate(tabId), click: () => tabs.duplicate(tabId) },
    {
      label: tab.webContents.isAudioMuted() ? 'Unmute tab' : 'Mute tab',
      click: () => tabs.toggleMute(tabId)
    },
    {
      label: 'Share with agents',
      checked: agent.isShared(tabId),
      shortcut: shortcut(`${shiftMod}A`),
      click: () => agent.toggleShared(tabId)
    },
    { type: 'separator' },
    { label: 'Close tab', shortcut: shortcut(`${mod}W`), click: () => tabs.close(tabId) },
    {
      label: 'Close other tabs',
      enabled: tabs.all.length > 1,
      click: () => tabs.closeOthers(tabId)
    },
    {
      label: 'Close tabs to the right',
      enabled: idsRightOf(tabs.all, tabId).length > 0,
      click: () => tabs.closeRightOf(tabId)
    },
    { type: 'separator' },
    {
      label: 'Reopen closed tab',
      enabled: tabs.canReopen,
      shortcut: `${shiftMod}T`,
      click: () => tabs.reopenClosed()
    }
  ]
  overlay.showMenu(template, x, y, { at: 'pointer', returnTo: window.webContents })
}
