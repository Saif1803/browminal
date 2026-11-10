import { clipboard } from 'electron'
import type { Bookmark, OpenDisposition } from '../shared/types'
import { openBookmark } from './bookmarks'
import type { MenuEntry, MenuModifiers } from './menu-model'
import type { MainWindow } from './window'

/** Ctrl/Cmd+click on a menu item opens it behind, Shift+click in front, like links. */
function dispositionFor({ ctrl, shift }: MenuModifiers): OpenDisposition {
  if (ctrl) return 'background'
  if (shift) return 'foreground'
  return 'current'
}

function barToggle({ bookmarks }: MainWindow): MenuEntry {
  return {
    label: 'Show bookmarks bar',
    checked: bookmarks.barVisible,
    // The shortcut itself is handled in shortcuts.ts; this only shows it.
    shortcut: process.platform === 'darwin' ? '⇧⌘B' : 'Ctrl+Shift+B',
    click: () => bookmarks.toggleBar()
  }
}

/** Right-click on a bookmark, or on the bar itself when `bookmark` is null. */
export function showBookmarkMenu(
  main: MainWindow,
  bookmark: Bookmark | null,
  x: number,
  y: number
): void {
  const { window, tabs, bookmarks, overlay } = main
  const template: MenuEntry[] = []
  if (bookmark) {
    template.push(
      { label: 'Open', click: () => openBookmark(tabs, bookmark, 'current') },
      { label: 'Open in new tab', click: () => openBookmark(tabs, bookmark, 'background') },
      { type: 'separator' },
      { label: 'Copy link address', click: () => clipboard.writeText(bookmark.url) },
      { label: 'Remove', click: () => bookmarks.remove(bookmark.id) },
      { type: 'separator' }
    )
  }
  template.push(barToggle(main))
  if (window.isDestroyed()) return
  overlay.showMenu(template, x, y, { at: 'pointer', returnTo: window.webContents })
}

/** The "»" button: the bookmarks from index `from` on, which don't fit on the bar. */
export function showBookmarksOverflow(main: MainWindow, from: number, x: number, y: number): void {
  const { window, tabs, bookmarks, overlay } = main
  const template: MenuEntry[] = bookmarks.all.slice(from).map((bookmark) => ({
    label: bookmark.title,
    icon: bookmark.favicon,
    click: (modifiers) => openBookmark(tabs, bookmark, dispositionFor(modifiers))
  }))
  if (template.length === 0 || window.isDestroyed()) return
  overlay.showMenu(template, x, y, {
    at: 'anchor',
    width: 280,
    returnTo: window.webContents,
    toggle: 'bookmarks-overflow'
  })
}
