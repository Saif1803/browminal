import { describe, expect, test } from 'bun:test'
import { clampDrag, dropIndex, movedIds, tabShift, type TabBox } from './tab-drag'

// Four tabs, 100 px wide, 1 px apart.
const boxes: TabBox[] = [0, 101, 202, 303].map((left) => ({ left, width: 100 }))

describe('clampDrag', () => {
  test('keeps the tab inside the strip', () => {
    expect(clampDrag(boxes, 1, -500)).toBe(-101)
    expect(clampDrag(boxes, 1, 500)).toBe(202)
    expect(clampDrag(boxes, 1, 30)).toBe(30)
  })

  test('a lone tab or an unknown one does not move', () => {
    expect(clampDrag([boxes[0]], 0, 50)).toBe(0)
    expect(clampDrag(boxes, 9, 50)).toBe(0)
  })
})

describe('dropIndex', () => {
  test('stays put until the middle of a neighbour is crossed', () => {
    expect(dropIndex(boxes, 1, 0)).toBe(1)
    expect(dropIndex(boxes, 1, 50)).toBe(1)
    expect(dropIndex(boxes, 1, 102)).toBe(2)
    expect(dropIndex(boxes, 1, -102)).toBe(0)
  })

  test('to either end', () => {
    expect(dropIndex(boxes, 0, 303)).toBe(3)
    expect(dropIndex(boxes, 3, -303)).toBe(0)
  })

  test('tabs of different widths', () => {
    const mixed: TabBox[] = [
      { left: 0, width: 200 },
      { left: 201, width: 50 },
      { left: 252, width: 50 }
    ]
    // The wide tab's middle (100) has to pass 226 to land after the second one.
    expect(dropIndex(mixed, 0, 120)).toBe(0)
    expect(dropIndex(mixed, 0, 130)).toBe(1)
  })

  test('an unknown tab lands where it is', () => {
    expect(dropIndex(boxes, 7, 100)).toBe(7)
  })
})

describe('tabShift', () => {
  test('dragging right: the tabs passed step left', () => {
    expect([0, 1, 2, 3].map((i) => tabShift(i, 0, 2, 101))).toEqual([0, -101, -101, 0])
  })

  test('dragging left: the tabs passed step right', () => {
    expect([0, 1, 2, 3].map((i) => tabShift(i, 3, 1, 101))).toEqual([0, 101, 101, 0])
  })

  test('in place: nothing moves', () => {
    expect([0, 1, 2, 3].map((i) => tabShift(i, 2, 2, 101))).toEqual([0, 0, 0, 0])
  })
})

describe('movedIds', () => {
  test('moves one id, clamped to the ends', () => {
    expect(movedIds([1, 2, 3, 4], 1, 2)).toEqual([2, 3, 1, 4])
    expect(movedIds([1, 2, 3, 4], 4, 0)).toEqual([4, 1, 2, 3])
    expect(movedIds([1, 2, 3, 4], 2, 99)).toEqual([1, 3, 4, 2])
  })

  test('an unknown id changes nothing', () => {
    expect(movedIds([1, 2, 3], 9, 0)).toEqual([1, 2, 3])
  })
})
