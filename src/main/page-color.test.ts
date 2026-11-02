import { describe, expect, test } from 'bun:test'
import { parsePageColor, veilCss } from './page-color'

describe('parsePageColor', () => {
  test('turns computed rgb colours into hex', () => {
    expect(parsePageColor('rgb(255, 255, 255)')).toBe('#ffffff')
    expect(parsePageColor('rgb(15, 15, 15)')).toBe('#0f0f0f')
    expect(parsePageColor('rgba(38, 38, 36, 1)')).toBe('#262624')
  })

  test('shows translucent colours over white', () => {
    expect(parsePageColor('rgba(0, 0, 0, 0.5)')).toBe('#808080')
    expect(parsePageColor('rgba(0, 0, 0, .25)')).toBe('#bfbfbf')
  })

  test('rejects transparent, other formats and junk', () => {
    expect(parsePageColor('rgba(0, 0, 0, 0)')).toBeNull()
    expect(parsePageColor('transparent')).toBeNull()
    expect(parsePageColor('oklch(0.5 0.1 200)')).toBeNull()
    expect(parsePageColor('rgb(300, 0, 0)')).toBeNull()
    expect(parsePageColor('rgb(0, 0, 0); } body { display: none')).toBeNull()
    expect(parsePageColor('')).toBeNull()
    expect(parsePageColor(null)).toBeNull()
    expect(parsePageColor(42)).toBeNull()
  })
})

describe('veilCss', () => {
  test('sets the colour, opacity and fade', () => {
    expect(veilCss('#262624', 1, 120)).toBe(
      'body{background:#262624!important;opacity:1!important;transition-duration:120ms!important}'
    )
    expect(veilCss('#ffffff', 0, -5)).toContain('transition-duration:0ms')
  })

  test('only takes hex colours', () => {
    expect(() => veilCss('red', 1, 0)).toThrow()
    expect(() => veilCss('#fff}body{x:y', 1, 0)).toThrow()
  })
})
