import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Session } from './session'
import { HOME_URL } from '../shared/url'
import { DEFAULT_SETTINGS, type Settings, type Startup } from './settings'
import type { JsonStore } from './store'

let folder: string
let file: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'browminal-session-'))
  file = join(folder, 'session.json')
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** Just enough of the settings store: Session only reads it. */
const settingsWith = (startup: Startup): JsonStore<Settings> =>
  ({ get: () => ({ ...DEFAULT_SETTINGS, startup }) }) as unknown as JsonStore<Settings>

const twoTabs = {
  tabs: [
    { url: 'http://localhost:3000/', title: 'App' },
    { url: 'https://example.com/', title: 'Example' }
  ],
  active: 1
}

const writeSession = (session: unknown): void => writeFileSync(file, JSON.stringify(session))

describe('Session', () => {
  test('brings back the last tabs when startup is "restore"', () => {
    writeSession({ version: 1, ...twoTabs })
    expect(new Session(folder, settingsWith('restore')).toRestore()).toEqual(twoTabs)
  })

  test('brings back nothing when startup is "home"', () => {
    writeSession({ version: 1, ...twoTabs })
    expect(new Session(folder, settingsWith('home')).toRestore()).toBeNull()
  })

  test('brings back nothing for no file, a broken one, or a lone start page', () => {
    expect(new Session(folder, settingsWith('restore')).toRestore()).toBeNull()
    writeFileSync(file, '{not json')
    expect(new Session(folder, settingsWith('restore')).toRestore()).toBeNull()
    writeSession({ version: 1, tabs: [{ url: HOME_URL, title: 'Home' }], active: 0 })
    expect(new Session(folder, settingsWith('restore')).toRestore()).toBeNull()
  })

  test('saves the tabs, and the next launch reads them back', () => {
    const session = new Session(folder, settingsWith('restore'))
    session.update(twoTabs)
    session.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, ...twoTabs })
    expect(new Session(folder, settingsWith('restore')).toRestore()).toEqual(twoTabs)
  })

  test('keeps no open pages on disk when startup is "home"', () => {
    writeSession({ version: 1, ...twoTabs })
    const session = new Session(folder, settingsWith('home'))
    session.update(twoTabs)
    session.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, tabs: [], active: 0 })
  })

  test('writes nothing when the tabs are what was saved', () => {
    const session = new Session(folder, settingsWith('restore'))
    session.update({ tabs: [], active: 0 })
    session.flush()
    expect(existsSync(file)).toBe(false)
  })
})
