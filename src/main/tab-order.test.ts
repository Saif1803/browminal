import { describe, expect, test } from 'bun:test'
import { activeAfterClose, insertionIndex, type TabOrderEntry } from './tab-order'

const tab = (id: number, openerId: number | null = null): TabOrderEntry => ({ id, openerId })

describe('insertionIndex', () => {
  test('tabs without an opener go at the end', () => {
    expect(insertionIndex([], null)).toBe(0)
    expect(insertionIndex([tab(1), tab(2)], null)).toBe(2)
  })

  test('opened tabs go right after their opener', () => {
    expect(insertionIndex([tab(1), tab(2), tab(3)], 1)).toBe(1)
    expect(insertionIndex([tab(1), tab(2), tab(3)], 3)).toBe(3)
  })

  test('opened tabs go after siblings from the same opener', () => {
    const tabs = [tab(1), tab(4, 1), tab(5, 1), tab(2), tab(3)]
    expect(insertionIndex(tabs, 1)).toBe(3)
  })

  test('siblings are only skipped while contiguous', () => {
    const tabs = [tab(1), tab(4, 1), tab(2), tab(5, 1)]
    expect(insertionIndex(tabs, 1)).toBe(2)
  })

  test('an opener that no longer exists means the end', () => {
    expect(insertionIndex([tab(1), tab(2)], 9)).toBe(2)
  })
})

describe('activeAfterClose', () => {
  const tabs = [tab(1), tab(2), tab(3)]

  test('closing a background tab keeps the active one', () => {
    expect(activeAfterClose(tabs, 1, 3)).toBe(3)
    expect(activeAfterClose(tabs, 3, 2)).toBe(2)
  })

  test('closing the active tab picks its right neighbour', () => {
    expect(activeAfterClose(tabs, 1, 1)).toBe(2)
    expect(activeAfterClose(tabs, 2, 2)).toBe(3)
  })

  test('closing the last active tab picks its left neighbour', () => {
    expect(activeAfterClose(tabs, 3, 3)).toBe(2)
  })

  test('closing the only tab leaves nothing', () => {
    expect(activeAfterClose([tab(1)], 1, 1)).toBeNull()
  })
})
