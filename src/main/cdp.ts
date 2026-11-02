import type { WebContents } from 'electron'

const PROTOCOL_VERSION = '1.3'
const COMMAND_TIMEOUT_MS = 15_000

type Params = Record<string, unknown>

/** An alert, confirm, prompt or "leave page?" dialog the page has open. */
export interface DialogInfo {
  type: string
  message: string
  defaultPrompt: string
}

/**
 * The Chrome DevTools Protocol on one tab, through Electron's own debugger (main attaches it;
 * nothing is exposed on a port). Attaches on the first command, with the Page domain on so it
 * knows about dialogs; detach() lets go.
 *
 * While the page shows a dialog its renderer is blocked, so commands would hang: they fail at
 * once instead, saying so (the agent answers with handle_dialog, or the user answers it).
 */
export class CdpSession {
  private dialogInfo: DialogInfo | null = null
  private readonly handlers = new Map<string, Set<(params: Params) => void>>()
  private attached = false

  constructor(private readonly webContents: WebContents) {}

  /** The dialog the page has open, or null. */
  get dialog(): DialogInfo | null {
    return this.dialogInfo
  }

  /** Calls `handler` for each `method` event (e.g. "Network.loadingFinished"). Returns an unsubscribe. */
  on(method: string, handler: (params: Params) => void): () => void {
    let set = this.handlers.get(method)
    if (!set) {
      set = new Set()
      this.handlers.set(method, set)
    }
    set.add(handler)
    return () => set.delete(handler)
  }

  /** Resolves with the next `method` event, or null after `timeoutMs`. */
  waitFor(method: string, timeoutMs: number): Promise<Params | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off()
        resolve(null)
      }, timeoutMs)
      const off = this.on(method, (params) => {
        clearTimeout(timer)
        off()
        resolve(params)
      })
    })
  }

  async send<T = Params>(
    method: string,
    params?: Params,
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<T> {
    await this.attach()
    if (this.dialogInfo && method !== 'Page.handleJavaScriptDialog')
      throw dialogError(this.dialogInfo)
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `${method} got no answer in ${timeoutMs / 1000}s: the page is busy or blocked`
            )
          ),
        timeoutMs
      )
    })
    // A dialog opening while the command waits blocks it: say so instead of waiting it out.
    let offDialog = (): void => {}
    const dialog = new Promise<never>((_, reject) => {
      offDialog = this.on('Page.javascriptDialogOpening', () =>
        reject(dialogError(this.dialogInfo!))
      )
    })
    try {
      const command = this.webContents.debugger.sendCommand(method, params) as Promise<T>
      return await Promise.race([command, timeout, dialog])
    } finally {
      clearTimeout(timer)
      offDialog()
    }
  }

  detach(): void {
    this.handlers.clear()
    this.dialogInfo = null
    if (this.webContents.isDestroyed()) return
    try {
      if (this.webContents.debugger.isAttached()) this.webContents.debugger.detach()
    } catch {
      // Already gone with the page.
    }
  }

  private async attach(): Promise<void> {
    if (this.webContents.isDestroyed()) throw new Error('The tab was closed')
    const { debugger: dbg } = this.webContents
    if (this.attached && dbg.isAttached()) return
    if (!dbg.isAttached()) {
      try {
        dbg.attach(PROTOCOL_VERSION)
      } catch (error) {
        throw new Error(
          `Couldn't attach to the page (${(error as Error).message}). ` +
            'If DevTools is open on this tab, close it and try again.'
        )
      }
    }
    if (!this.attached) {
      this.attached = true
      dbg.on('message', this.onMessage)
      dbg.once('detach', () => {
        dbg.off('message', this.onMessage)
        this.attached = false
        this.dialogInfo = null
      })
    }
    await dbg.sendCommand('Page.enable')
  }

  private readonly onMessage = (_event: Electron.Event, method: string, params: Params): void => {
    if (method === 'Page.javascriptDialogOpening') {
      this.dialogInfo = {
        type: String(params.type ?? 'alert'),
        message: String(params.message ?? ''),
        defaultPrompt: String(params.defaultPrompt ?? '')
      }
    } else if (method === 'Page.javascriptDialogClosed') {
      this.dialogInfo = null
    }
    for (const handler of this.handlers.get(method) ?? []) handler(params)
  }
}

function dialogError({ type, message }: DialogInfo): Error {
  const what =
    type === 'beforeunload' ? 'a "Leave this page?" dialog' : `${type}(${JSON.stringify(message)})`
  return new Error(
    `The page is showing ${what} and waits for an answer. Answer it with handle_dialog ` +
      '(or the user answers it in Nebula).'
  )
}
