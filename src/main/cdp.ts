import type { WebContents } from 'electron'

const PROTOCOL_VERSION = '1.3'
const COMMAND_TIMEOUT_MS = 15_000

/**
 * Refs from frames in another process start here. A ref below it is a backend DOM node id in
 * the tab's own renderer (as it always was); one at or above it names an element in a frame
 * session, through `refs`. Backend node ids are counted per renderer, so the two can't share.
 */
export const FRAME_REF_BASE = 1_000_000_000
// Refs handed out for frames in other processes before the table starts over.
const MAX_FRAME_REFS = 200_000

type Params = Record<string, unknown>
type Handler = (params: Params) => void
/** Sends a command straight to the debugger (for attach hooks, which run inside attach). */
export type RawSend = (method: string, params?: Params) => Promise<unknown>

/** An alert, confirm, prompt or "leave page?" dialog the page has open. */
export interface DialogInfo {
  type: string
  message: string
  defaultPrompt: string
}

/** What tools talk to: the tab's own session, or one of its frames in another process. */
export interface CdpTarget {
  readonly dialog: DialogInfo | null
  send<T = Params>(method: string, params?: Params, timeoutMs?: number): Promise<T>
  on(method: string, handler: Handler): () => void
}

/** Where a ref's element lives: the session to ask, and its backend node id there. */
export interface NodeAt {
  session: CdpTarget
  node: number
  /** The frame session, or null for an element in the tab's own renderer. */
  frame: FrameSession | null
}

/**
 * Where a frame's document runs: the session to send to, and its main world's execution
 * context there (undefined: the session's own main frame, the default for Runtime.evaluate).
 */
export interface FrameWorld {
  session: CdpTarget
  contextId: number | undefined
  /** The frame's URL (another process's frame) or origin (one in the same process). */
  url: string
}

export const staleRefError = (ref: number): Error =>
  new Error(`No element with ref=${ref} on the page now (it changed?). Call read_page again.`)

// How deep refAt follows frames in other processes inside each other.
const MAX_FRAME_DEPTH = 8

// A new frame waits until its session is set up (logs on), so nothing it does early is missed;
// frameAttached always lets it run, whatever the hooks did.
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }

/**
 * An iframe that runs in another renderer process (an embed from another site), reached
 * through the tab's debugger as a child session (`Target.setAutoAttach` with `flatten`).
 * It lives until that frame navigates away to another process or goes.
 */
export class FrameSession implements CdpTarget {
  constructor(
    private readonly root: CdpSession,
    readonly sessionId: string,
    /** The frame's id (its target id), as the page's frame tree names it. */
    readonly frameId: string,
    /** The session of the frame that holds its `<iframe>`: null for the tab's own renderer. */
    readonly parent: FrameSession | null,
    public url: string
  ) {}

  get dialog(): DialogInfo | null {
    return this.root.dialog
  }

  send<T = Params>(method: string, params?: Params, timeoutMs?: number): Promise<T> {
    return this.root.sendIn<T>(this.sessionId, method, params, timeoutMs)
  }

  on(method: string, handler: Handler): () => void {
    return this.root.onIn(this.sessionId, method, handler)
  }

  /** The session that holds this frame's `<iframe>` element. */
  get parentTarget(): CdpTarget {
    return this.parent ?? this.root
  }
}

/**
 * The Chrome DevTools Protocol on one tab, through Electron's own debugger (main attaches it;
 * nothing is exposed on a port). Attaches on the first command, with the Page domain on so it
 * knows about dialogs; detach() lets go. Iframes in other processes are attached too, each as
 * a `FrameSession`, so tools can read and act in them; their elements get refs from
 * `FRAME_REF_BASE` up.
 *
 * While the page shows a dialog its renderer is blocked, so commands would hang: they fail at
 * once instead, saying so (the agent answers with handle_dialog, or the user answers it).
 */
export class CdpSession implements CdpTarget {
  private dialogInfo: DialogInfo | null = null
  /** The frame session whose page opened the dialog, or null for the tab's own. */
  private dialogFrame: FrameSession | null = null
  /** Event handlers by session ('' for the tab's own) and method. */
  private readonly handlers = new Map<string, Set<Handler>>()
  private readonly attachHooks = new Set<(send: RawSend) => Promise<void>>()
  private readonly frameHooks = new Set<(frame: FrameSession) => Promise<void>>()
  private readonly frameSessions = new Map<string, FrameSession>()
  private readonly frameRefs = new Map<number, { frame: FrameSession; node: number }>()
  private readonly frameRefIds = new Map<string, number>()
  /** Each frame's main world, by frame id: its session ('' for the tab's own) and context. */
  private readonly worlds = new Map<string, { sessionId: string; id: number; origin: string }>()
  private nextFrameRef = FRAME_REF_BASE
  private attached = false
  /** Settles once a fresh attach has enabled Page and run the hooks. */
  private setup: Promise<void> = Promise.resolve()

  constructor(private readonly webContents: WebContents) {}

  /** The dialog the page (or one of its frames) has open, or null. */
  get dialog(): DialogInfo | null {
    return this.dialogInfo
  }

  /** The iframes in other processes, as attached now. */
  get frames(): FrameSession[] {
    return [...this.frameSessions.values()]
  }

  /** Calls `handler` for each `method` event (e.g. "Network.loadingFinished"). Returns an unsubscribe. */
  on(method: string, handler: Handler): () => void {
    return this.onIn(undefined, method, handler)
  }

  /** `on` for one session's events (a frame's); the tab's own with no session. */
  onIn(sessionId: string | undefined, method: string, handler: Handler): () => void {
    const key = `${sessionId ?? ''}\n${method}`
    let set = this.handlers.get(key)
    if (!set) {
      set = new Set()
      this.handlers.set(key, set)
    }
    set.add(handler)
    return () => set.delete(handler)
  }

  /**
   * Runs `hook` each time the debugger is attached afresh (the first time, and after something
   * else detached it), to enable domains or put back state. Its errors are ignored.
   */
  onAttach(hook: (send: RawSend) => Promise<void>): void {
    this.attachHooks.add(hook)
  }

  /** Runs `hook` for each frame session as it's attached (to listen there). Errors are ignored. */
  onFrame(hook: (frame: FrameSession) => Promise<void>): void {
    this.frameHooks.add(hook)
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

  send<T = Params>(method: string, params?: Params, timeoutMs?: number): Promise<T> {
    // The dialog is answered where it opened, which may be a frame.
    const sessionId =
      method === 'Page.handleJavaScriptDialog' ? this.dialogFrame?.sessionId : undefined
    return this.sendIn<T>(sessionId, method, params, timeoutMs)
  }

  /** `send` to one session (a frame's); the tab's own with no session. */
  async sendIn<T = Params>(
    sessionId: string | undefined,
    method: string,
    params?: Params,
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<T> {
    await this.attach()
    if (sessionId !== undefined && !this.frameSessions.has(sessionId)) {
      throw new Error('That frame is gone (it navigated or was removed). Call read_page again.')
    }
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
    const offDialogs: (() => void)[] = []
    const dialog = new Promise<never>((_, reject) => {
      const opened = (): void => reject(dialogError(this.dialogInfo!))
      offDialogs.push(this.on('Page.javascriptDialogOpening', opened))
      for (const frame of this.frameSessions.values()) {
        offDialogs.push(frame.on('Page.javascriptDialogOpening', opened))
      }
    })
    try {
      const command = this.webContents.debugger.sendCommand(method, params, sessionId) as Promise<T>
      return await Promise.race([command, timeout, dialog])
    } finally {
      clearTimeout(timer)
      for (const off of offDialogs) off()
    }
  }

  /**
   * The ref an agent sees for element `node` of `frame` (null: the tab's own renderer, where
   * the ref is the node id itself). The same element keeps its ref while its frame lives.
   */
  refOf(frame: FrameSession | null, node: number): number {
    if (!frame) return node
    const key = `${frame.sessionId}\n${node}`
    const known = this.frameRefIds.get(key)
    if (known !== undefined) return known
    if (this.frameRefs.size >= MAX_FRAME_REFS) this.forgetFrameRefs(() => true)
    const ref = this.nextFrameRef++
    this.frameRefs.set(ref, { frame, node })
    this.frameRefIds.set(key, ref)
    return ref
  }

  /** Where element `ref` is: which session to ask and its node id there. Throws for a stale ref. */
  at(ref: number): NodeAt {
    if (ref < FRAME_REF_BASE) return { session: this, node: ref, frame: null }
    const entry = this.frameRefs.get(ref)
    if (!entry || !this.frameSessions.has(entry.frame.sessionId)) throw staleRefError(ref)
    return { session: entry.frame, node: entry.node, frame: entry.frame }
  }

  /**
   * Where `frame`'s viewport starts in the tab's (CSS px): its `<iframe>`'s content box, plus
   * that of each frame around it. Frame sessions report positions in their own viewport; input
   * goes to the tab, so a point there needs this added. With `scroll`, each `<iframe>` is
   * scrolled into view in its parent first, outermost first.
   */
  async frameOffset(frame: FrameSession | null, scroll = false): Promise<{ x: number; y: number }> {
    if (!frame) return { x: 0, y: 0 }
    const outer = frame.parent
    if (scroll) await this.frameOffset(outer, true)
    const parent = frame.parentTarget
    const { backendNodeId } = await parent.send<{ backendNodeId: number }>('DOM.getFrameOwner', {
      frameId: frame.frameId
    })
    if (scroll) {
      await parent.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})
    }
    const { model } = await parent.send<{ model: { content: number[] } }>('DOM.getBoxModel', {
      backendNodeId
    })
    const base = await this.frameOffset(outer)
    return { x: base.x + model.content[0], y: base.y + model.content[1] }
  }

  /**
   * Where the document of the `<iframe>` element `ref` runs, to evaluate code in it. Frames in
   * the same process are found by their main world's execution context (Runtime must be on;
   * TabDebug turns it on), frames in another process by their session.
   */
  async worldOf(ref: number): Promise<FrameWorld> {
    const { session, node, frame } = this.at(ref)
    let described: { nodeName?: string; frameId?: string }
    try {
      ;({ node: described } = await session.send<{ node: typeof described }>('DOM.describeNode', {
        backendNodeId: node
      }))
    } catch (error) {
      if (this.dialog) throw error
      throw staleRefError(ref)
    }
    const { frameId } = described
    if (!frameId) {
      const tag = String(described.nodeName ?? 'element').toLowerCase()
      throw new Error(
        `ref=${ref} is a <${tag}>, not an <iframe>: give an iframe's ref from read_page`
      )
    }
    const elsewhere = this.frames.find((other) => other.frameId === frameId)
    if (elsewhere) return { session: elsewhere, contextId: undefined, url: elsewhere.url }
    const world = this.worlds.get(frameId)
    if (!world || world.sessionId !== (frame?.sessionId ?? '')) {
      throw new Error(`The frame in ref=${ref} has no document running yet (still loading?)`)
    }
    return { session, contextId: world.id, url: world.origin }
  }

  /**
   * The ref of the element at (x, y) in CSS px from the tab's top left, looking inside frames of
   * other processes (the tab's own hit test stops at their `<iframe>`).
   */
  async refAt(x: number, y: number): Promise<number> {
    let frame: FrameSession | null = null
    let point = { x, y }
    for (let depth = 0; ; depth++) {
      const target: CdpTarget = frame ?? this
      const { backendNodeId } = await target.send<{ backendNodeId: number }>(
        'DOM.getNodeForLocation',
        { x: Math.round(point.x), y: Math.round(point.y), ignorePointerEventsNone: true }
      )
      const { node } = await target
        .send<{ node: { frameId?: string } }>('DOM.describeNode', { backendNodeId })
        .catch(() => ({ node: {} as { frameId?: string } }))
      const inner = node.frameId
        ? this.frames.find((other) => other.frameId === node.frameId && other.parent === frame)
        : undefined
      if (!inner || depth >= MAX_FRAME_DEPTH) return this.refOf(frame, backendNodeId)
      const offset = await this.frameOffset(inner)
      point = { x: x - offset.x, y: y - offset.y }
      frame = inner
    }
  }

  detach(): void {
    this.handlers.clear()
    this.attachHooks.clear()
    this.frameHooks.clear()
    this.dropFrames()
    this.dialogInfo = null
    this.dialogFrame = null
    if (this.webContents.isDestroyed()) return
    try {
      if (this.webContents.debugger.isAttached()) this.webContents.debugger.detach()
    } catch {
      // Already gone with the page.
    }
  }

  /** Attaches now (commands attach on their own; this is for listening from the start). */
  async attach(): Promise<void> {
    if (this.webContents.isDestroyed()) throw new Error('The tab was closed')
    const { debugger: dbg } = this.webContents
    if (this.attached && dbg.isAttached()) return this.setup
    if (!dbg.isAttached()) {
      try {
        dbg.attach(PROTOCOL_VERSION)
      } catch (error) {
        throw new Error(
          `Couldn't attach to the page (${(error as Error).message}). ` +
            'If DevTools is open on this tab, close it and try again.',
          { cause: error }
        )
      }
    }
    if (this.attached) {
      await dbg.sendCommand('Page.enable')
      return
    }
    // Callers that come while this runs wait for it too (through `setup`).
    this.attached = true
    dbg.on('message', this.onMessage)
    dbg.once('detach', () => {
      dbg.off('message', this.onMessage)
      this.attached = false
      this.dialogInfo = null
      this.dialogFrame = null
      this.dropFrames()
    })
    const send: RawSend = (method, params) => dbg.sendCommand(method, params)
    const setup = (async () => {
      await dbg.sendCommand('Page.enable')
      for (const hook of this.attachHooks) await hook(send).catch(() => {})
      // Frames in other processes: each comes as Target.attachedToTarget (onMessage).
      await dbg.sendCommand('Target.setAutoAttach', AUTO_ATTACH).catch(() => {})
    })()
    this.setup = setup.catch(() => {})
    await setup
  }

  private readonly onMessage = (
    _event: Electron.Event,
    method: string,
    params: Params,
    sessionId?: string
  ): void => {
    const frame = sessionId ? (this.frameSessions.get(sessionId) ?? null) : null
    if (sessionId && !frame) return
    if (method === 'Page.javascriptDialogOpening') {
      this.dialogInfo = {
        type: String(params.type ?? 'alert'),
        message: String(params.message ?? ''),
        defaultPrompt: String(params.defaultPrompt ?? '')
      }
      this.dialogFrame = frame
    } else if (method === 'Page.javascriptDialogClosed') {
      this.dialogInfo = null
      this.dialogFrame = null
    } else if (method === 'Target.attachedToTarget') {
      this.frameAttached(frame, params)
    } else if (method === 'Target.detachedFromTarget') {
      if (typeof params.sessionId === 'string') this.frameDetached(params.sessionId)
    } else if (method.startsWith('Runtime.executionContext')) {
      this.trackWorld(sessionId ?? '', method, params)
    } else if (method === 'Target.targetInfoChanged') {
      const info = (params.targetInfo ?? {}) as { targetId?: string; url?: string }
      for (const known of this.frameSessions.values()) {
        if (known.frameId === info.targetId && typeof info.url === 'string') known.url = info.url
      }
    }
    for (const handler of this.handlers.get(`${sessionId ?? ''}\n${method}`) ?? []) {
      handler(params)
    }
  }

  /** Keeps `worlds` in step with Runtime's execution contexts in session `sessionId`. */
  private trackWorld(sessionId: string, method: string, params: Params): void {
    if (method === 'Runtime.executionContextCreated') {
      const context = (params.context ?? {}) as {
        id?: unknown
        origin?: unknown
        auxData?: { isDefault?: unknown; frameId?: unknown }
      }
      const { auxData } = context
      if (typeof context.id !== 'number' || auxData?.isDefault !== true) return
      if (typeof auxData.frameId !== 'string') return
      this.worlds.set(auxData.frameId, {
        sessionId,
        id: context.id,
        origin: String(context.origin ?? '')
      })
    } else if (method === 'Runtime.executionContextDestroyed') {
      this.dropWorlds(
        (world) => world.sessionId === sessionId && world.id === params.executionContextId
      )
    } else if (method === 'Runtime.executionContextsCleared') {
      this.dropWorlds((world) => world.sessionId === sessionId)
    }
  }

  private dropWorlds(drop: (world: { sessionId: string; id: number }) => boolean): void {
    for (const [frameId, world] of this.worlds) if (drop(world)) this.worlds.delete(frameId)
  }

  private frameAttached(parent: FrameSession | null, params: Params): void {
    const { debugger: dbg } = this.webContents
    const sessionId = params.sessionId
    const info = (params.targetInfo ?? {}) as { targetId?: string; type?: string; url?: string }
    if (typeof sessionId !== 'string') return
    if (info.type !== 'iframe' || typeof info.targetId !== 'string') {
      // Workers and the like: not ours to look at. Let them run and let go.
      dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {})
      dbg.sendCommand('Target.detachFromTarget', { sessionId }).catch(() => {})
      return
    }
    const frame = new FrameSession(this, sessionId, info.targetId, parent, String(info.url ?? ''))
    this.frameSessions.set(sessionId, frame)
    void (async () => {
      const send = (method: string, p?: Params): Promise<unknown> =>
        dbg.sendCommand(method, p, sessionId)
      await send('Page.enable').catch(() => {})
      // Its own iframes from yet other processes.
      await send('Target.setAutoAttach', AUTO_ATTACH).catch(() => {})
      for (const hook of this.frameHooks) await hook(frame).catch(() => {})
      await send('Runtime.runIfWaitingForDebugger').catch(() => {})
    })()
  }

  private frameDetached(sessionId: string): void {
    const frame = this.frameSessions.get(sessionId)
    if (!frame) return
    this.frameSessions.delete(sessionId)
    if (this.dialogFrame === frame) {
      this.dialogFrame = null
      this.dialogInfo = null
    }
    const prefix = `${sessionId}\n`
    for (const key of this.handlers.keys()) if (key.startsWith(prefix)) this.handlers.delete(key)
    this.forgetFrameRefs((entry) => entry === frame)
    this.dropWorlds((world) => world.sessionId === sessionId)
    // The frames inside it went with it.
    for (const inner of [...this.frameSessions.values()]) {
      if (inner.parent === frame) this.frameDetached(inner.sessionId)
    }
  }

  private dropFrames(): void {
    for (const sessionId of [...this.frameSessions.keys()]) this.frameDetached(sessionId)
    this.worlds.clear()
  }

  private forgetFrameRefs(drop: (frame: FrameSession) => boolean): void {
    for (const [ref, entry] of this.frameRefs) {
      if (!drop(entry.frame)) continue
      this.frameRefs.delete(ref)
      this.frameRefIds.delete(`${entry.frame.sessionId}\n${entry.node}`)
    }
  }
}

function dialogError({ type, message }: DialogInfo): Error {
  const what =
    type === 'beforeunload' ? 'a "Leave this page?" dialog' : `${type}(${JSON.stringify(message)})`
  return new Error(
    `The page is showing ${what} and waits for an answer. Answer it with handle_dialog ` +
      '(or the user answers it in Browminal).'
  )
}
