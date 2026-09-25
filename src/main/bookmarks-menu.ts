import {
  clipboard,
  Menu,
  nativeImage,
  type KeyboardEvent,
  type MenuItemConstructorOptions,
  type NativeImage
} from 'electron'
import type { Bookmark, OpenDisposition } from '../shared/types'
import { openBookmark } from './bookmarks'
import { menuText } from './menu-text'
import type { MainWindow } from './window'

const TITLE_LENGTH = 60
const MENU_ICON_SIZE = 16

const shorten = (text: string): string =>
  text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1)}…` : text

function menuIcon(favicon: string | null): NativeImage | undefined {
  if (!favicon) return undefined
  const image = nativeImage.createFromDataURL(favicon)
  return image.isEmpty() ? undefined : image.resize({ width: MENU_ICON_SIZE })
}

/** Ctrl/Cmd+click on a menu item opens it behind, Shift+click in front, like links. */
function dispositionFor(event: KeyboardEvent): OpenDisposition {
  if (event.ctrlKey || event.metaKey) return 'background'
  if (event.shiftKey) return 'foreground'
  return 'current'
}

function barToggle({ bookmarks }: MainWindow): MenuItemConstructorOptions {
  return {
    label: 'Show bookmarks bar',
    type: 'checkbox',
    checked: bookmarks.barVisible,
    accelerator: 'CommandOrControl+Shift+B',
    // The shortcut itself is handled in shortcuts.ts; this only shows it.
    registerAccelerator: false,
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
  const { window, tabs, bookmarks } = main
  const template: MenuItemConstructorOptions[] = []
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
  if (!window.isDestroyed()) Menu.buildFromTemplate(template).popup({ window, x, y })
}

/** The "»" button: the bookmarks from index `from` on, which don't fit on the bar. */
export function showBookmarksOverflow(main: MainWindow, from: number, x: number, y: number): void {
  const { window, tabs, bookmarks } = main
  const template: MenuItemConstructorOptions[] = bookmarks.all.slice(from).map((bookmark) => ({
    label: menuText(shorten(bookmark.title)),
    icon: menuIcon(bookmark.favicon),
    click: (_item, _window, event) => openBookmark(tabs, bookmark, dispositionFor(event))
  }))
  if (template.length === 0) return
  if (!window.isDestroyed()) Menu.buildFromTemplate(template).popup({ window, x, y })
}
