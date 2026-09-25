import { describe, expect, test } from 'bun:test'
import { sniffImageType } from './image-type'

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values)
const BOM = String.fromCharCode(0xfeff)
const text = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('sniffImageType', () => {
  test('recognises binary formats', () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png'
    )
    expect(sniffImageType(bytes(0, 0, 1, 0, 1, 0))).toBe('image/x-icon')
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffImageType(text('GIF89a...'))).toBe('image/gif')
    expect(sniffImageType(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffImageType(text('BM\0\0'))).toBe('image/bmp')
  })

  test('recognises SVG, with or without a prolog', () => {
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml'
    )
    expect(
      sniffImageType(text(BOM + '  <?xml version="1.0"?>\n<!-- logo -->\n<svg>\n</svg>'))
    ).toBe('image/svg+xml')
    expect(
      sniffImageType(
        text('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg viewBox="0 0 1 1"/>')
      )
    ).toBe('image/svg+xml')
  })

  test('rejects everything else', () => {
    expect(sniffImageType(bytes())).toBeNull()
    expect(sniffImageType(text('<!doctype html><html><svg></svg></html>'))).toBeNull()
    expect(sniffImageType(text('<svgfoo>'))).toBeNull()
    expect(sniffImageType(text('RIFF\0\0\0\0WAVE'))).toBeNull()
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e))).toBeNull()
  })
})
