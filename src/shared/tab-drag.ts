/**
 * Pure: dragging a tab along the strip. The strip measures its tabs when a drag starts (left
 * edge and width of each, in strip order); these say where the dragged tab may go, where it
 * would land, and how far the others step aside meanwhile.
 */

export interface TabBox {
  left: number
  width: number
}

/** How far the pointer moves (px) before a press on a tab becomes a drag. */
export const TAB_DRAG_THRESHOLD = 4

/** The pointer's movement, kept so the dragged tab stays between the first and last tab's edges. */
export function clampDrag(boxes: readonly TabBox[], from: number, dx: number): number {
  const box = boxes[from]
  if (!box || boxes.length < 2) return 0
  const first = boxes[0]
  const last = boxes[boxes.length - 1]
  const min = first.left - box.left
  const max = last.left + last.width - (box.left + box.width)
  return Math.max(min, Math.min(max, dx))
}

/**
 * Where the dragged tab lands: past every other tab whose middle its own middle has reached
 * (so a tab held against either end lands there). The index is in the strip after the move
 * (what `moveTab` takes).
 */
export function dropIndex(boxes: readonly TabBox[], from: number, dx: number): number {
  const box = boxes[from]
  if (!box) return from
  const middle = box.left + box.width / 2 + dx
  let index = 0
  boxes.forEach((other, i) => {
    const otherMiddle = other.left + other.width / 2
    if (i < from ? otherMiddle < middle : i > from && otherMiddle <= middle) index++
  })
  return index
}

/** How far tab `i` steps aside (px) while the tab at `from` hovers at `to`: one slot, `step` wide. */
export function tabShift(i: number, from: number, to: number, step: number): number {
  if (i === from) return 0
  if (from < to && i > from && i <= to) return -step
  if (to < from && i >= to && i < from) return step
  return 0
}

/** The strip's tab ids after moving `id` to `to` (to show the new order before main confirms it). */
export function movedIds(ids: readonly number[], id: number, to: number): number[] {
  const from = ids.indexOf(id)
  if (from === -1) return [...ids]
  const rest = ids.filter((other) => other !== id)
  const target = Math.max(0, Math.min(to, rest.length))
  return [...rest.slice(0, target), id, ...rest.slice(target)]
}
