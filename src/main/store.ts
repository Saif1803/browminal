import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

const SAVE_DELAY_MS = 500

export interface StoreOptions<T> {
  /** Checks what was read (parsed JSON, or undefined when there's no usable file). */
  parse: (raw: unknown) => T
  /** What to write; defaults to the value itself. */
  serialize?: (value: T) => unknown
  saveDelayMs?: number
}

/**
 * One JSON file (in userData), read once when created and written back after changes.
 * - Reading never trusts the file: `parse` checks it, and a missing or broken file gives its
 *   defaults. A file that isn't valid JSON is kept as "<name>.broken" before it's replaced.
 * - Writes are debounced, and atomic (a temp file renamed over the old one), so a crash
 *   leaves the old file or the new one, never half of one. Call flush() before quitting.
 */
export class JsonStore<T> {
  private value: T
  private timer: ReturnType<typeof setTimeout> | null = null
  // Changed since the last successful write.
  private dirty = false
  private readonly serialize: (value: T) => unknown
  private readonly saveDelayMs: number

  constructor(
    readonly path: string,
    { parse, serialize = (value) => value, saveDelayMs = SAVE_DELAY_MS }: StoreOptions<T>
  ) {
    this.serialize = serialize
    this.saveDelayMs = saveDelayMs
    this.value = parse(this.read())
  }

  get(): T {
    return this.value
  }

  /** Replaces the value; the file is written a moment later. */
  set(value: T): void {
    this.value = value
    this.dirty = true
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), this.saveDelayMs)
  }

  /** Writes a pending change now. */
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (this.dirty) this.write()
  }

  private read(): unknown {
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch {
      return undefined
    }
    try {
      return JSON.parse(text)
    } catch {
      try {
        copyFileSync(this.path, `${this.path}.broken`)
      } catch {
        // Nothing more to save.
      }
      return undefined
    }
  }

  private write(): void {
    const temp = `${this.path}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(temp, `${JSON.stringify(this.serialize(this.value), null, 2)}\n`)
      renameSync(temp, this.path)
      this.dirty = false
    } catch (error) {
      // The value stays in memory; the next change (or flush on quit) tries again.
      console.error(`Could not save ${this.path}:`, error)
    }
  }
}
