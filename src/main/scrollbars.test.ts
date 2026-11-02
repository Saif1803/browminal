import { describe, expect, test } from 'bun:test'
import { parseAccent, scrollbarCss } from './scrollbars'

describe('parseAccent', () => {
  test('keeps hex colours, lower-cased', () => {
    expect(parseAccent('#1E2327')).toBe('#1e2327')
    expect(parseAccent('#1e232780')).toBe('#1e232780')
  })

  test('rejects anything else', () => {
    expect(parseAccent(null)).toBeNull()
    expect(parseAccent('')).toBeNull()
    expect(parseAccent('red')).toBeNull()
    expect(parseAccent('#fff')).toBeNull()
    expect(parseAccent('rgb(0 0 0)')).toBeNull()
    expect(parseAccent('#000000; } * { display: none')).toBeNull()
  })
})

describe('scrollbarCss', () => {
  test('tints the thumb with the accent', () => {
    expect(scrollbarCss('#d97757')).toContain('color-mix(in srgb, #d97757 60%, #8a8a8a)')
  })

  test('falls back to a neutral thumb', () => {
    const css = scrollbarCss(null)
    expect(css).toContain('color-mix(in srgb, #8a8a8a 40%, transparent)')
    expect(css).not.toContain('null')
  })
})
