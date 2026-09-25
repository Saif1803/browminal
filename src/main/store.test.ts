import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonStore } from './store'

interface Counter {
  count: number
}

const parse = (raw: unknown): Counter =>
  typeof (raw as Counter | undefined)?.count === 'number' ? (raw as Counter) : { count: 0 }

let folder: string
let path: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'nebula-store-'))
  path = join(folder, 'counter.json')
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

describe('JsonStore', () => {
  test('gives the defaults when there is no file', () => {
    expect(new JsonStore(path, { parse }).get()).toEqual({ count: 0 })
    expect(existsSync(path)).toBe(false)
  })

  test('reads and checks an existing file', () => {
    writeFileSync(path, JSON.stringify({ count: 5 }))
    expect(new JsonStore(path, { parse }).get()).toEqual({ count: 5 })
    writeFileSync(path, JSON.stringify({ count: 'five' }))
    expect(new JsonStore(path, { parse }).get()).toEqual({ count: 0 })
  })

  test('keeps a copy of a file that is not JSON', () => {
    writeFileSync(path, '{"count": 5')
    const store = new JsonStore(path, { parse })
    expect(store.get()).toEqual({ count: 0 })
    expect(readFileSync(`${path}.broken`, 'utf8')).toBe('{"count": 5')
  })

  test('writes after the delay, not on every change', async () => {
    const store = new JsonStore(path, { parse, saveDelayMs: 20 })
    store.set({ count: 1 })
    store.set({ count: 2 })
    expect(store.get()).toEqual({ count: 2 })
    expect(existsSync(path)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(readJson(path)).toEqual({ count: 2 })
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  test('flush writes a pending change at once, and only then', () => {
    const store = new JsonStore(path, { parse, saveDelayMs: 60_000 })
    store.flush()
    expect(existsSync(path)).toBe(false)
    store.set({ count: 3 })
    store.flush()
    expect(readJson(path)).toEqual({ count: 3 })
  })

  test('writes what serialize returns and creates the folder', () => {
    const nested = join(folder, 'a', 'b', 'c.json')
    const store = new JsonStore(nested, {
      parse: (raw) => (raw as { value?: number } | undefined)?.value ?? 0,
      serialize: (value) => ({ value })
    })
    store.set(7)
    store.flush()
    expect(readJson(nested)).toEqual({ value: 7 })
    expect(new JsonStore(nested, { parse: (raw) => raw }).get()).toEqual({ value: 7 })
  })

  test('tries again on flush after a failed write', () => {
    // A folder where the file should be makes the rename fail.
    mkdirSync(path)
    const store = new JsonStore(path, { parse, saveDelayMs: 60_000 })
    const error = console.error
    console.error = () => {}
    try {
      store.set({ count: 4 })
      store.flush()
    } finally {
      console.error = error
    }
    rmSync(path, { recursive: true })
    store.flush()
    expect(readJson(path)).toEqual({ count: 4 })
  })
})
