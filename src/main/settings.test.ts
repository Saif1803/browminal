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
    const saved = {
      bookmarksBarVisible: false,
      adblock: { enabled: false, pausedSites: ['example.com', 'news.bbc.co.uk'] },
      agent: { enabled: true, port: 9400, shareAll: true },
      terminal: {
        dock: 'right' as const,
        height: 420,
        width: 640,
        folders: { 'http://localhost:5173': process.platform === 'win32' ? 'C:\\shop' : '/shop' },
        agentCommand: 'claude --model opus'
      }
    }
    expect(parseSettings(saved)).toEqual(saved)
  })

  test('replaces wrong values with defaults and drops unknown ones', () => {
    expect(parseSettings({ bookmarksBarVisible: 'no', theme: 'pink' })).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ adblock: 'off' })).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ adblock: { enabled: 1, pausedSites: 'example.com' } })).toEqual(
      DEFAULT_SETTINGS
    )
  })

  test('keeps only real, distinct sites where ad blocking is paused', () => {
    const { adblock } = parseSettings({
      adblock: {
        enabled: true,
        pausedSites: [
          'example.com',
          'example.com',
          'www.example.com',
          'EXAMPLE.org',
          'a/b',
          'https://x.com',
          '',
          42,
          null,
          'localhost',
          '[::1]'
        ]
      }
    })
    expect(adblock.pausedSites).toEqual(['example.com', 'localhost', '[::1]'])
  })

  test('caps the paused sites', () => {
    const pausedSites = Array.from({ length: 1500 }, (_, i) => `site${i}.com`)
    expect(parseSettings({ adblock: { pausedSites } }).adblock.pausedSites).toHaveLength(1000)
  })

  test('checks the terminal settings one by one', () => {
    const folder = process.platform === 'win32' ? 'C:\\shop' : '/shop'
    const { terminal } = parseSettings({
      terminal: {
        dock: 'left',
        height: 50,
        width: 4.5,
        folders: {
          'http://localhost:5173': folder,
          'http://localhost:5173/path': folder,
          'nebula://home': folder,
          'https://example.com': 'relative/dir'
        },
        agentCommand: 'claude\nrm -rf /'
      }
    })
    expect(terminal).toEqual({
      ...DEFAULT_SETTINGS.terminal,
      folders: { 'http://localhost:5173': folder }
    })
  })

  test('checks the agent settings one by one', () => {
    expect(parseSettings({ agent: { enabled: true, port: 80, shareAll: 'yes' } }).agent).toEqual({
      ...DEFAULT_SETTINGS.agent,
      enabled: true
    })
    expect(parseSettings({ agent: { port: 9500 } }).agent.port).toBe(9500)
    expect(parseSettings({ agent: [] }).agent).toEqual(DEFAULT_SETTINGS.agent)
  })
})
