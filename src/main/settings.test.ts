import { describe, expect, test } from 'bun:test'
import { DEFAULT_SETTINGS, parseSettings } from './settings'

describe('parseSettings', () => {
  test('gives the defaults for a missing or foreign file', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('hello')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS)
  })

  test('reads saved settings', () => {
    expect(parseSettings({ bookmarksBarVisible: false })).toEqual({ bookmarksBarVisible: false })
  })

  test('replaces wrong values with defaults and drops unknown ones', () => {
    expect(parseSettings({ bookmarksBarVisible: 'no', theme: 'pink' })).toEqual(DEFAULT_SETTINGS)
  })
})
