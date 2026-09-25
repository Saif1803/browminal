import { describe, expect, test } from 'bun:test'
import { cleanUserAgent } from './user-agent'

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.235 Safari/537.36'

describe('cleanUserAgent', () => {
  test('removes the Electron and app tokens', () => {
    const electron =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) nebula/1.0.0 Chrome/142.0.7444.235 Electron/39.8.10 Safari/537.36'
    expect(cleanUserAgent(electron, 'nebula')).toBe(CHROME)
  })

  test('matches the app name case-insensitively', () => {
    const electron = CHROME.replace('Chrome/', 'Nebula/1.0.0 Chrome/')
    expect(cleanUserAgent(electron, 'nebula')).toBe(CHROME)
  })

  test('leaves a plain Chrome user agent alone', () => {
    expect(cleanUserAgent(CHROME, 'nebula')).toBe(CHROME)
  })

  test('only removes whole tokens', () => {
    const ua = 'Mozilla/5.0 NotElectron/1 Chrome/142.0 Safari/537.36'
    expect(cleanUserAgent(ua, 'nebula')).toBe(ua)
  })

  test('app names with regex characters are matched literally', () => {
    expect(cleanUserAgent('A/1 my.app/2 B/3', 'my.app')).toBe('A/1 B/3')
    expect(cleanUserAgent('A/1 myxapp/2 B/3', 'my.app')).toBe('A/1 myxapp/2 B/3')
  })
})
