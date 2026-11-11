import { copyText } from './copy-text'
import { existsSync } from 'fs'
import { describeStatus, isActive, shortenMiddle } from '../shared/downloads'
import type { DownloadEntry, Downloads } from './downloads'
import type { MenuEntry } from './menu-model'
import type { MainWindow } from './window'

const MAX_SHOWN = 15
const NAME_LENGTH = 48

function entryActions(downloads: Downloads, entry: DownloadEntry): MenuEntry[] {
  const { id } = entry
  const items: MenuEntry[] = []
  switch (entry.status) {
    case 'progressing':
      items.push({ label: 'Pause', click: () => downloads.pause(id) })
      break
    case 'paused':
    case 'interrupted':
      items.push({
        label: 'Resume',
        enabled: entry.item.canResume(),
        click: () => downloads.resume(id)
      })
      break
    case 'completed':
      if (existsSync(entry.path)) {
        items.push(
          { label: 'Open', click: () => downloads.open(id) },
          { label: 'Show in folder', click: () => downloads.showInFolder(id) }
        )
      } else {
        items.push({ label: 'File was moved or deleted', enabled: false })
      }
      break
  }
  items.push({ label: 'Copy download link', click: () => copyText(entry.url) })
  items.push(
    isActive(entry.status)
      ? { label: 'Cancel', click: () => downloads.cancel(id) }
      : { label: 'Remove from list', click: () => downloads.remove(id) }
  )
  return items
}

/**
 * The downloads list as an overlay menu: one submenu of actions per download, then the folder
 * and "Clear list". A placeholder until the design pass brings a real panel.
 */
export function showDownloadsMenu(main: MainWindow, x: number, y: number): void {
  const { window, downloads, overlay } = main
  const entries = downloads.all
  const shown = entries.slice(0, MAX_SHOWN)
  const template: MenuEntry[] = shown.map((entry) => {
    const missing = entry.status === 'completed' && !existsSync(entry.path)
    const status = missing ? 'Deleted' : describeStatus(entry)
    return {
      label: `${shortenMiddle(entry.filename, NAME_LENGTH)} — ${status}`,
      submenu: entryActions(downloads, entry)
    }
  })
  if (entries.length > MAX_SHOWN) {
    template.push({ label: `${entries.length - MAX_SHOWN} older downloads` })
  }
  if (template.length > 0) template.push({ type: 'separator' })
  template.push(
    { label: 'Open Downloads folder', click: () => downloads.openFolder() },
    {
      label: 'Clear list',
      enabled: entries.some((entry) => !isActive(entry.status)),
      click: () => downloads.clearFinished()
    }
  )
  if (window.isDestroyed()) return
  overlay.showMenu(template, x, y, {
    at: 'anchor',
    width: 360,
    returnTo: window.webContents,
    toggle: 'downloads'
  })
}
