/** Chrome's zoom steps. */
export const ZOOM_FACTORS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5
] as const

const EPSILON = 0.001

/** The next step in or out from `current`, which may be between steps (pinch zoom). */
export function nextZoomFactor(current: number, direction: 'in' | 'out'): number {
  if (direction === 'in') {
    return ZOOM_FACTORS.find((factor) => factor > current + EPSILON) ?? ZOOM_FACTORS.at(-1)!
  }
  return ZOOM_FACTORS.findLast((factor) => factor < current - EPSILON) ?? ZOOM_FACTORS[0]
}
