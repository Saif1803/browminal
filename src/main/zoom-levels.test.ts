import { describe, expect, test } from 'bun:test'
import { nextZoomFactor } from './zoom-levels'

describe('nextZoomFactor', () => {
  test('steps through Chrome zoom levels', () => {
    expect(nextZoomFactor(1, 'in')).toBe(1.1)
    expect(nextZoomFactor(1.1, 'in')).toBe(1.25)
    expect(nextZoomFactor(1, 'out')).toBe(0.9)
    expect(nextZoomFactor(0.9, 'out')).toBe(0.8)
  })

  test('snaps to the next step from in-between values', () => {
    expect(nextZoomFactor(1.05, 'in')).toBe(1.1)
    expect(nextZoomFactor(1.05, 'out')).toBe(1)
    // Floating point noise from getZoomFactor must not skip or repeat a step.
    expect(nextZoomFactor(1.0999999, 'in')).toBe(1.25)
    expect(nextZoomFactor(1.1000001, 'out')).toBe(1)
  })

  test('stops at the ends', () => {
    expect(nextZoomFactor(5, 'in')).toBe(5)
    expect(nextZoomFactor(0.25, 'out')).toBe(0.25)
    expect(nextZoomFactor(9, 'in')).toBe(5)
    expect(nextZoomFactor(0.1, 'out')).toBe(0.25)
  })
})
