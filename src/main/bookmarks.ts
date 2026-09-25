import { nativeImage } from 'electron'
import { join } from 'path'
import type { Bookmark, OpenDisposition } from '../shared/types'
import {
  addBookmark,
  findBookmark,
  isFaviconDataUrl,
  parseBookmarkFile,
  removeBookmark,
  removeBookmarksOf,
  setFavicon,
  toBookmarkFile
} from './bookmark-list'
import type { Settings } from './settings'
import { JsonStore } from './store'
import type { TabManager } from './tab-manager'
import type { Tab } from './tabs'

const ICON_SIZE = 32

/**
 * Bookmarks shrink the tab's favicon to a 32px PNG when Electron can decode it (PNG, JPEG,
 * and ICO on Windows); other formats are kept as they are if they're small enough.
 */
function compactFavicon(favicon: string | null): string | null {
  if (!favicon) return null
  const image = nativeImage.createFromDataURL(favicon)
  if (!image.isEmpty()) {
    const small = image.getSize().width > ICON_SIZE ? image.resize({ width: ICON_SIZE }) : image
    const png = small.toDataURL()
    if (png.length < favicon.length) return png
  }
  return isFaviconDataUrl(favicon) ? favicon : null
}

/**
 * The bookmarks (bookmarks.json) and whether the bookmarks bar is shown (settings.json).
 * Lives for the whole app, like Downloads.
 */
export class Bookmarks {
  private readonly store: JsonStore<readonly Bookmark[]>
  private listeners = new Set<() => void>()

  constructor(
    folder: string,
    private readonly settings: JsonStore<Settings>
  ) {
    this.store = new JsonStore<readonly Bookmark[]>(join(folder, 'bookmarks.json'), {
      parse: parseBookmarkFile,
      serialize: toBookmarkFile
    })
  }

  /** Called on every change to the bookmarks or the bar. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get all(): readonly Bookmark[] {
    return this.store.get()
  }

  get(id: number): Bookmark | undefined {
    return this.all.find((bookmark) => bookmark.id === id)
  }

  isBookmarked(url: string): boolean {
    return findBookmark(this.all, url) !== undefined
  }

  get barVisible(): boolean {
    return this.settings.get().bookmarksBarVisible
  }

  /** Ctrl+Shift+B, and the menus' "Show bookmarks bar". */
  toggleBar(): void {
    this.settings.set({ ...this.settings.get(), bookmarksBarVisible: !this.barVisible })
    this.changed()
  }

  /** The star and Ctrl+D: bookmarks the tab's page, or removes its bookmark. */
  toggleTab(tab: Tab): void {
    const { url, title, favicon } = tab.getSummary()
    if (this.isBookmarked(url)) {
      this.update(removeBookmarksOf(this.all, url))
      return
    }
    this.update(
      addBookmark(this.all, {
        url,
        // An error page's title describes the error, not the page.
        title: tab.isErrorPage ? '' : title,
        favicon: compactFavicon(favicon)
      })
    )
  }

  remove(id: number): void {
    this.update(removeBookmark(this.all, id))
  }

  /** A tab loaded the icon of `url`: bookmarks of that page pick it up. */
  updateFavicon(url: string, favicon: string): void {
    if (!this.isBookmarked(url)) return
    const compact = compactFavicon(favicon)
    if (compact) this.update(setFavicon(this.all, url, compact))
  }

  /** Writes unsaved changes now. Call before quitting. */
  flush(): void {
    this.store.flush()
  }

  private update(next: readonly Bookmark[]): void {
    if (next === this.all) return
    this.store.set(next)
    this.changed()
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Opens a bookmark in the active tab, or in a new tab in front of or behind it. */
export function openBookmark(
  tabs: TabManager,
  bookmark: Bookmark,
  disposition: OpenDisposition
): void {
  if (disposition === 'current') {
    tabs.active.load(bookmark.url)
    tabs.active.webContents.focus()
  } else {
    tabs.create({ url: bookmark.url, background: disposition === 'background' })
  }
}
