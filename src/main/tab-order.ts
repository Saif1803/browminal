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
