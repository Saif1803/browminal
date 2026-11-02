import { describe, expect, test } from 'bun:test'
import { glassMaterial } from './glass'

describe('glassMaterial', () => {
  test('macOS uses vibrancy', () => {
    expect(glassMaterial('darwin', '24.1.0')).toBe('vibrancy')
  })

  test('Windows 11 22H2 and later use acrylic', () => {
    expect(glassMaterial('win32', '10.0.22621')).toBe('acrylic')
    expect(glassMaterial('win32', '10.0.26200')).toBe('acrylic')
  })

  test('older Windows stays solid', () => {
    expect(glassMaterial('win32', '10.0.22000')).toBeNull()
    expect(glassMaterial('win32', '10.0.19045')).toBeNull()
    expect(glassMaterial('win32', '6.3.9600')).toBeNull()
  })

  test('a release it cannot read stays solid', () => {
    expect(glassMaterial('win32', '')).toBeNull()
    expect(glassMaterial('win32', 'unknown')).toBeNull()
  })

  test('Linux stays solid', () => {
    expect(glassMaterial('linux', '6.8.0')).toBeNull()
  })
})
