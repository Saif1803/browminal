import { app, dialog, session, shell, type BrowserWindow, type DownloadItem } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { isActive } from '../shared/downloads'
import type { DownloadStatus, DownloadSummary } from '../shared/types'
import { safeFilename, uniqueFilename } from './download-names'
import type { MainWindow } from './window'

// Older finished downloads drop off the list beyond this.
const MAX_ENTRIES = 50
// Windows and macOS file names are case-insensitive.
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
const pathKey = (path: string): string => (caseInsensitive ? path.toLowerCase() : path)

export interface DownloadEntry {
  readonly id: number
  readonly item: DownloadItem
  /** Where the file is saved, in the Downloads folder. */
  readonly path: string
  readonly filename: string
  readonly url: string
  status: DownloadStatus
  receivedBytes: number
  totalBytes: number
}

/**
 * Every download of the session. Files are saved straight into the Downloads folder under a
 * name that isn't taken ("file (1).zip"), and never opened automatically. Only pages in tabs
 * can download. The list lives until the app quits.
 */
export class Downloads {
  /** Newest first. */
  private entries: DownloadEntry[] = []
  /** Paths claimed by downloads still running, so two downloads never share a file. */
  private reserved = new Set<string>()
  private listeners = new Set<() => void>()
  private quitConfirmed = false

  constructor(private readonly getMain: () => MainWindow | null) {
    session.defaultSession.on('will-download', (event, item, wc) => {
      const tabs = this.getMain()?.tabs
      if (!tabs?.all.some((tab) => tab.webContents === wc)) {
        event.preventDefault()
        return
      }
      if (!this.start(item)) {
        event.preventDefault()
        return
      }
      // A link that opened a new tab just to download (target=_blank) leaves no empty tab behind.
      setImmediate(() => tabs.closeIfBlank(wc))
    })
  }

  /** Called on every change: progress, a new download, a finished one. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get all(): readonly DownloadEntry[] {
    return this.entries
  }

  get(id: number): DownloadEntry | undefined {
    return this.entries.find((entry) => entry.id === id)
  }

  getState(): DownloadSummary[] {
    return this.entries.map(({ id, filename, status, receivedBytes, totalBytes }) => ({
      id,
      filename,
      status,
      receivedBytes,
      totalBytes
    }))
  }

  pause(id: number): void {
    const entry = this.get(id)
    if (entry?.status !== 'progressing') return
    entry.item.pause()
    this.update(entry)
  }

  /** Continues a paused download, or retries an interrupted one where it stopped. */
  resume(id: number): void {
    const entry = this.get(id)
    if (!entry || (entry.status !== 'paused' && entry.status !== 'interrupted')) return
    if (!entry.item.canResume()) return
    entry.item.resume()
    this.update(entry)
  }

  cancel(id: number): void {
    const entry = this.get(id)
    if (entry && isActive(entry.status)) entry.item.cancel()
  }

  /** Opens a finished file with its default app. Only ever on the user's request. */
  open(id: number): void {
    const entry = this.get(id)
    if (entry?.status === 'completed' && existsSync(entry.path)) void shell.openPath(entry.path)
  }

  showInFolder(id: number): void {
    const entry = this.get(id)
    if (entry?.status === 'completed' && existsSync(entry.path)) shell.showItemInFolder(entry.path)
  }

  openFolder(): void {
    void shell.openPath(app.getPath('downloads'))
  }

  /** Removes one finished download from the list (the file stays). */
  remove(id: number): void {
    const entry = this.get(id)
    if (!entry || isActive(entry.status)) return
    this.entries = this.entries.filter((other) => other !== entry)
    this.changed()
  }

  /** Removes every finished download from the list; running ones stay. */
  clearFinished(): void {
    this.entries = this.entries.filter((entry) => isActive(entry.status))
    this.changed()
  }

  /**
   * Asks before quitting while downloads are running. Returns true when it's fine to quit;
   * after a yes it doesn't ask again.
   */
  confirmQuit(window: BrowserWindow | null): boolean {
    if (this.quitConfirmed) return true
    const running = this.entries.filter((entry) => isActive(entry.status)).length
    if (running === 0) return true

    const options: Electron.MessageBoxSyncOptions = {
      type: 'warning',
      title: 'Downloads in progress',
      message:
        running === 1
          ? 'A download is still in progress'
          : `${running} downloads are still in progress`,
      detail:
        running === 1
          ? 'Quitting Browminal now cancels it.'
          : 'Quitting Browminal now cancels them.',
      buttons: ['Quit and cancel', 'Keep downloading'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }
    const response =
      window && !window.isDestroyed()
        ? dialog.showMessageBoxSync(window, options)
        : dialog.showMessageBoxSync(options)
    this.quitConfirmed = response === 0
    return this.quitConfirmed
  }

  /** Cancels whatever is still running, so no partial files are left behind. */
  cancelAll(): void {
    for (const entry of this.entries) if (isActive(entry.status)) entry.item.cancel()
  }

  /** Picks the file name and starts tracking. Returns false if the download can't be saved. */
  private start(item: DownloadItem): boolean {
    const folder = app.getPath('downloads')
    try {
      mkdirSync(folder, { recursive: true })
    } catch {
      return false
    }
    const filename = uniqueFilename(safeFilename(item.getFilename()), (name) => {
      const path = join(folder, name)
      return this.reserved.has(pathKey(path)) || existsSync(path)
    })
    const path = join(folder, filename)
    item.setSavePath(path)
    this.reserved.add(pathKey(path))

    const entry: DownloadEntry = {
      id: nextId(),
      item,
      path,
      filename,
      url: item.getURL(),
      status: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes()
    }
    this.entries.unshift(entry)
    this.trim()

    item.on('updated', () => this.update(entry))
    item.once('done', (_event, state) => {
      this.reserved.delete(pathKey(path))
      entry.receivedBytes = item.getReceivedBytes()
      entry.totalBytes = item.getTotalBytes()
      entry.status = state === 'interrupted' ? 'failed' : state
      // Bounces the Downloads stack in the Dock.
      if (state === 'completed' && process.platform === 'darwin') app.dock?.downloadFinished(path)
      this.changed()
    })
    this.changed()
    return true
  }

  /** Reads progress and state from the item while it's running. */
  private update(entry: DownloadEntry): void {
    const { item } = entry
    const state = item.getState()
    if (state !== 'progressing' && state !== 'interrupted') return
    entry.receivedBytes = item.getReceivedBytes()
    entry.totalBytes = item.getTotalBytes()
    entry.status =
      state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
    this.changed()
  }

  /** Drops the oldest finished downloads once the list is too long. */
  private trim(): void {
    let excess = this.entries.length - MAX_ENTRIES
    for (let i = this.entries.length - 1; i >= 0 && excess > 0; i--) {
      if (!isActive(this.entries[i].status)) {
        this.entries.splice(i, 1)
        excess--
      }
    }
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }
}

let lastId = 0
const nextId = (): number => ++lastId
