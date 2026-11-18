import { join } from 'path'
import {
  EMPTY_SESSION,
  isWorthRestoring,
  parseSessionFile,
  toSessionFile,
  type SavedSession
} from './session-file'
import type { Settings } from './settings'
import { JsonStore } from './store'

/**
 * The open tabs, kept in session.json so the next launch brings them back (Settings → startup
 * "restore", the default). With startup "home" nothing about open pages is kept on disk.
 * Sharing with agents is never kept: it's always a fresh decision.
 */
export class Session {
  private readonly store: JsonStore<SavedSession>
  // The last session handed to the store, as JSON, so unchanged pushes write nothing.
  private last: string

  constructor(
    userData: string,
    private readonly settings: JsonStore<Settings>
  ) {
    this.store = new JsonStore(join(userData, 'session.json'), {
      parse: parseSessionFile,
      serialize: toSessionFile
    })
    this.last = JSON.stringify(this.store.get())
  }

  private get restores(): boolean {
    return this.settings.get().startup === 'restore'
  }

  /** What a new window should bring back, or null for one start page. */
  toRestore(): SavedSession | null {
    const saved = this.store.get()
    return this.restores && isWorthRestoring(saved) ? saved : null
  }

  /** The window's tabs as they are now (TabManager.snapshot); written a moment later. */
  update(session: SavedSession): void {
    const next = this.restores ? session : EMPTY_SESSION
    const json = JSON.stringify(next)
    if (json === this.last) return
    this.last = json
    this.store.set(next)
  }

  flush(): void {
    this.store.flush()
  }
}
