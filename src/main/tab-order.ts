/** What tab-order decisions need to know about each tab, in strip order. */
export interface TabOrderEntry {
  id: number
  /** The tab whose page opened this one (link, window.open), if any. */
  openerId: number | null
}

/**
 * Where a new tab goes. Tabs a page opens go right after it, after any siblings it
 * already opened, so links opened in a row stay in reading order. Others go at the end.
 */
export function insertionIndex(tabs: readonly TabOrderEntry[], openerId: number | null): number {
  const openerIndex = openerId === null ? -1 : tabs.findIndex((tab) => tab.id === openerId)
  if (openerIndex === -1) return tabs.length

  let index = openerIndex + 1
  while (index < tabs.length && tabs[index].openerId === openerId) index++
  return index
}

/**
 * Which tab to activate after closing one: unchanged unless the active tab closes,
 * then its right neighbour, else its left one. Null when no tabs remain.
 */
export function activeAfterClose(
  tabs: readonly TabOrderEntry[],
  closingId: number,
  activeId: number
): number | null {
  const remaining = tabs.filter((tab) => tab.id !== closingId)
  if (remaining.length === 0) return null
  if (closingId !== activeId) return activeId

  const index = tabs.findIndex((tab) => tab.id === closingId)
  if (index === -1) return activeId
  return remaining[Math.min(index, remaining.length - 1)].id
}

/**
 * Where the tab at `from` ends up when it's dragged to `to`: both inside the strip, or null
 * when there's nothing to move.
 */
export function moveTarget(count: number, from: number, to: number): number | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= count) return null
  const target = Math.max(0, Math.min(to, count - 1))
  return target === from ? null : target
}

/** The tabs right of `id`, in strip order (the tab menu's "Close tabs to the right"). */
export function idsRightOf(tabs: readonly TabOrderEntry[], id: number): number[] {
  const index = tabs.findIndex((tab) => tab.id === id)
  return index === -1 ? [] : tabs.slice(index + 1).map((tab) => tab.id)
}
