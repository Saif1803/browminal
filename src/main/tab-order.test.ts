import { describe, expect, test } from 'bun:test'
import {
  activeAfterClose,
  idsRightOf,
  insertionIndex,
  moveTarget,
  type TabOrderEntry
} from './tab-order'

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

describe('moveTarget', () => {
  test('a tab dragged inside the strip goes where it is dropped', () => {
    expect(moveTarget(4, 0, 2)).toBe(2)
    expect(moveTarget(4, 3, 0)).toBe(0)
  })

  test('a drop past either end lands on the end', () => {
    expect(moveTarget(4, 1, 99)).toBe(3)
    expect(moveTarget(4, 2, -5)).toBe(0)
  })

  test('nothing to move: the same place, or a tab that is not there', () => {
    expect(moveTarget(4, 2, 2)).toBeNull()
    expect(moveTarget(4, 3, 99)).toBeNull()
    expect(moveTarget(4, 4, 0)).toBeNull()
    expect(moveTarget(4, -1, 0)).toBeNull()
    expect(moveTarget(4, 1.5, 0)).toBeNull()
  })
})

describe('idsRightOf', () => {
  test('the tabs after it, in order', () => {
    expect(idsRightOf([tab(1), tab(2), tab(3)], 1)).toEqual([2, 3])
    expect(idsRightOf([tab(1), tab(2), tab(3)], 3)).toEqual([])
    expect(idsRightOf([tab(1)], 9)).toEqual([])
  })
})
