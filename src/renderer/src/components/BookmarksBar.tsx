import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import type { Bookmark, OpenDisposition } from '@shared/types'
import { ChevronsRightIcon, GlobeIcon } from './icons'

/** Like links: Ctrl/Cmd+click or middle-click opens behind, Shift+click opens in front. */
function dispositionFor(event: MouseEvent): OpenDisposition {
  if (event.button === 1 || event.ctrlKey || event.metaKey) return 'background'
  if (event.shiftKey) return 'foreground'
  return 'current'
}

function BookmarkChip({
  bookmark,
  hidden
}: {
  bookmark: Bookmark
  hidden: boolean
}): React.JSX.Element {
  const { browser } = window

  const open = (event: MouseEvent): void => {
    if (event.button === 0 || event.button === 1) {
      browser.openBookmark(bookmark.id, dispositionFor(event))
    }
  }

  const showMenu = (event: MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    browser.showBookmarkMenu(bookmark.id, Math.round(event.clientX), Math.round(event.clientY))
  }

  return (
    <button
      type="button"
      title={bookmark.title === bookmark.url ? bookmark.url : `${bookmark.title}\n${bookmark.url}`}
      // Chips past the edge stay laid out (so they can be measured) but out of reach.
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      onClick={open}
      // The middle button would start autoscroll.
      onMouseDown={(event) => event.button === 1 && event.preventDefault()}
      onAuxClick={open}
      onContextMenu={showMenu}
      className={`flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${
        hidden ? 'invisible' : ''
      }`}
    >
      {bookmark.favicon ? (
        <img src={bookmark.favicon} alt="" className="size-4 shrink-0" />
      ) : (
        <GlobeIcon width={14} height={14} className="shrink-0 text-ink-faint" />
      )}
      <span className="truncate">{bookmark.title}</span>
    </button>
  )
}

/**
 * The bookmarks bar, below the toolbar. Bookmarks that don't fit go into the "»" menu.
 * Right-click opens a native menu (open, remove, hide the bar).
 */
export function BookmarksBar({ bookmarks }: { bookmarks: Bookmark[] }): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const overflowRef = useRef<HTMLButtonElement>(null)
  const [fitting, setFitting] = useState(bookmarks.length)
  const { browser } = window

  // Measure again when what the chips show changes (state pushes send new arrays every time).
  const layoutKey = bookmarks.map((b) => `${b.id}:${b.favicon ? 1 : 0}:${b.title}`).join('\n')

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = (): void => {
      const limit = list.clientWidth
      let count = 0
      for (const chip of Array.from(list.children) as HTMLElement[]) {
        if (chip.offsetLeft + chip.offsetWidth > limit) break
        count++
      }
      setFitting(count)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [layoutKey])

  const showOverflow = (): void => {
    const rect = overflowRef.current?.getBoundingClientRect()
    if (!rect) return
    browser.showBookmarksOverflow(fitting, Math.round(rect.left), Math.round(rect.bottom) + 4)
  }

  const showBarMenu = (event: MouseEvent): void => {
    event.preventDefault()
    browser.showBookmarkMenu(null, Math.round(event.clientX), Math.round(event.clientY))
  }

  return (
    <div
      role="toolbar"
      aria-label="Bookmarks"
      onContextMenu={showBarMenu}
      // Not a window drag area: right-click would open the OS window menu instead of ours.
      className="app-no-drag flex h-8 items-center gap-1 bg-bar px-2 pb-1"
    >
      <div
        ref={listRef}
        className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
      >
        {bookmarks.map((bookmark, index) => (
          <BookmarkChip key={bookmark.id} bookmark={bookmark} hidden={index >= fitting} />
        ))}
      </div>
      {fitting < bookmarks.length && (
        <button
          ref={overflowRef}
          type="button"
          aria-label="More bookmarks"
          title="More bookmarks"
          onClick={showOverflow}
          className="grid size-6 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronsRightIcon width={14} height={14} />
        </button>
      )}
    </div>
  )
}
