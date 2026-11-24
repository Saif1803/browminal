import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'bun:test'
import type { WebContents } from 'electron'
import { CdpSession, FRAME_REF_BASE } from './cdp'

type Params = Record<string, unknown>
type Sent = { method: string; params?: Params; sessionId?: string }

interface FakeTab {
  webContents: WebContents
  sent: Sent[]
  /** A debugger event; `sessionId` '' is the tab's own session. */
  emit: (method: string, params: Params, sessionId?: string) => void
}

/** A stand-in for webContents.debugger: records commands, answers with `reply`. */
function fakeTab(reply: (sent: Sent) => unknown = () => ({})): FakeTab {
  const dbg = new EventEmitter() as EventEmitter & Record<string, unknown>
  const sent: Sent[] = []
  let attached = false
  dbg.attach = () => {
    attached = true
  }
  dbg.isAttached = () => attached
  dbg.detach = () => {
    attached = false
    dbg.emit('detach')
  }
  dbg.sendCommand = async (method: string, params?: Params, sessionId?: string) => {
    sent.push({ method, params, sessionId })
    return reply({ method, params, sessionId })
  }
  const webContents = { isDestroyed: () => false, debugger: dbg } as unknown as WebContents
  const emit = (method: string, params: Params, sessionId = ''): void => {
    dbg.emit('message', {}, method, params, sessionId)
  }
  return { webContents, sent, emit }
}

const attachFrame = (
  emit: (method: string, params: Params, sessionId?: string) => void,
  sessionId: string,
  frameId: string,
  parentSession = ''
): void =>
  emit(
    'Target.attachedToTarget',
    { sessionId, targetInfo: { targetId: frameId, type: 'iframe', url: 'https://other.test/' } },
    parentSession
  )

describe('CdpSession frames', () => {
  test('a frame in another process is attached, told to run, and its refs map back', async () => {
    const { webContents, sent, emit } = fakeTab()
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    expect(sent.some((s) => s.method === 'Target.setAutoAttach' && !s.sessionId)).toBe(true)
    attachFrame(emit, 's1', 'F1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cdp.frames.map((frame) => frame.frameId)).toEqual(['F1'])
    expect(
      sent.some((s) => s.method === 'Runtime.runIfWaitingForDebugger' && s.sessionId === 's1')
    ).toBe(true)

    const frame = cdp.frames[0]
    const ref = cdp.refOf(frame, 42)
    expect(ref).toBeGreaterThanOrEqual(FRAME_REF_BASE)
    expect(cdp.refOf(frame, 42)).toBe(ref)
    expect(cdp.refOf(null, 42)).toBe(42)
    const at = cdp.at(ref)
    expect(at.node).toBe(42)
    expect(at.frame).toBe(frame)
    expect(cdp.at(42).frame).toBeNull()

    await at.session.send('DOM.focus', { backendNodeId: 42 })
    expect(sent.at(-1)).toEqual({
      method: 'DOM.focus',
      params: { backendNodeId: 42 },
      sessionId: 's1'
    })
  })

  test('refs of a frame that went are stale, and so are those of frames inside it', async () => {
    const { webContents, emit } = fakeTab()
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    attachFrame(emit, 's1', 'F1')
    attachFrame(emit, 's2', 'F2', 's1')
    const [outer, inner] = cdp.frames
    expect(inner.parent).toBe(outer)
    const innerRef = cdp.refOf(inner, 7)
    emit('Target.detachedFromTarget', { sessionId: 's1' })
    expect(cdp.frames).toEqual([])
    expect(() => cdp.at(innerRef)).toThrow(/No element with ref=/)
    await expect(inner.send('DOM.focus')).rejects.toThrow(/frame is gone/)
  })

  test('workers are let go', async () => {
    const { webContents, sent, emit } = fakeTab()
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    emit('Target.attachedToTarget', {
      sessionId: 'w1',
      targetInfo: { targetId: 'W', type: 'worker' }
    })
    expect(cdp.frames).toEqual([])
    expect(sent.some((s) => s.method === 'Target.detachFromTarget')).toBe(true)
  })

  test('events reach the session they came from only', async () => {
    const { webContents, emit } = fakeTab()
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    attachFrame(emit, 's1', 'F1')
    const tabHeard: unknown[] = []
    const frameHeard: unknown[] = []
    cdp.on('Runtime.consoleAPICalled', (p) => tabHeard.push(p.n))
    cdp.frames[0].on('Runtime.consoleAPICalled', (p) => frameHeard.push(p.n))
    emit('Runtime.consoleAPICalled', { n: 1 })
    emit('Runtime.consoleAPICalled', { n: 2 }, 's1')
    expect(tabHeard).toEqual([1])
    expect(frameHeard).toEqual([2])
  })

  test('a frame’s offset adds up its <iframe>s’ content boxes', async () => {
    const boxes: Record<string, number[]> = { '': [10, 20], s1: [100, 5] }
    const { webContents, emit } = fakeTab(({ method, sessionId }) => {
      if (method === 'DOM.getFrameOwner') return { backendNodeId: 1 }
      if (method === 'DOM.getBoxModel') {
        const [x, y] = boxes[sessionId ?? '']
        return { model: { content: [x, y, 0, 0, 0, 0, 0, 0] } }
      }
      return {}
    })
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    attachFrame(emit, 's1', 'F1')
    attachFrame(emit, 's2', 'F2', 's1')
    const [outer, inner] = cdp.frames
    expect(await cdp.frameOffset(null)).toEqual({ x: 0, y: 0 })
    expect(await cdp.frameOffset(outer)).toEqual({ x: 10, y: 20 })
    expect(await cdp.frameOffset(inner)).toEqual({ x: 110, y: 25 })
  })

  test('a dialog opened in a frame is answered there', async () => {
    const { webContents, sent, emit } = fakeTab()
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    attachFrame(emit, 's1', 'F1')
    emit('Page.javascriptDialogOpening', { type: 'alert', message: 'hi' }, 's1')
    expect(cdp.dialog?.message).toBe('hi')
    await expect(cdp.send('DOM.focus')).rejects.toThrow(/handle_dialog/)
    await cdp.send('Page.handleJavaScriptDialog', { accept: true })
    expect(sent.at(-1)?.sessionId).toBe('s1')
  })
})

describe('CdpSession frame worlds and hit tests', () => {
  const created = (id: number, frameId: string, isDefault = true): Params => ({
    context: { id, origin: 'https://same.test', auxData: { isDefault, frameId } }
  })

  test('an <iframe> in the same process runs code in its main world', async () => {
    const { webContents, emit } = fakeTab(({ method, params }) => {
      if (method === 'DOM.describeNode') {
        return {
          node:
            params?.backendNodeId === 5
              ? { nodeName: 'IFRAME', frameId: 'L1' }
              : { nodeName: 'DIV' }
        }
      }
      return {}
    })
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    emit('Runtime.executionContextCreated', created(3, 'L1', false))
    emit('Runtime.executionContextCreated', created(4, 'L1'))
    const world = await cdp.worldOf(5)
    expect(world.session).toBe(cdp)
    expect(world.contextId).toBe(4)
    expect(world.url).toBe('https://same.test')
    await expect(cdp.worldOf(6)).rejects.toThrow(/is a <div>, not an <iframe>/)

    emit('Runtime.executionContextDestroyed', { executionContextId: 4 })
    await expect(cdp.worldOf(5)).rejects.toThrow(/no document running yet/)
    emit('Runtime.executionContextCreated', created(9, 'L1'))
    expect((await cdp.worldOf(5)).contextId).toBe(9)
    emit('Runtime.executionContextsCleared', {})
    await expect(cdp.worldOf(5)).rejects.toThrow(/no document running yet/)
  })

  test('an <iframe> of another process runs code in that frame’s session', async () => {
    const { webContents, emit } = fakeTab(({ method }) =>
      method === 'DOM.describeNode' ? { node: { nodeName: 'IFRAME', frameId: 'F1' } } : {}
    )
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    attachFrame(emit, 's1', 'F1')
    const world = await cdp.worldOf(5)
    expect(world.session).toBe(cdp.frames[0])
    expect(world.contextId).toBeUndefined()
    expect(world.url).toBe('https://other.test/')
  })

  test('a world of one session is not used for an <iframe> in another', async () => {
    const { webContents, emit } = fakeTab(({ method }) =>
      method === 'DOM.describeNode' ? { node: { nodeName: 'IFRAME', frameId: 'L1' } } : {}
    )
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    attachFrame(emit, 's1', 'F1')
    // L1's world is in the tab's renderer, but the ref names an element in frame s1.
    emit('Runtime.executionContextCreated', created(4, 'L1'))
    const ref = cdp.refOf(cdp.frames[0], 5)
    await expect(cdp.worldOf(ref)).rejects.toThrow(/no document running yet/)
  })

  test('refAt looks inside a frame of another process', async () => {
    const { webContents, sent, emit } = fakeTab(({ method, sessionId }) => {
      if (method === 'DOM.getNodeForLocation') return { backendNodeId: sessionId ? 70 : 12 }
      if (method === 'DOM.describeNode') {
        return { node: sessionId ? { nodeName: 'BUTTON' } : { nodeName: 'IFRAME', frameId: 'F1' } }
      }
      if (method === 'DOM.getFrameOwner') return { backendNodeId: 12 }
      if (method === 'DOM.getBoxModel') return { model: { content: [100, 40, 0, 0, 0, 0, 0, 0] } }
      return {}
    })
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    attachFrame(emit, 's1', 'F1')
    const ref = await cdp.refAt(130, 50)
    expect(ref).toBeGreaterThanOrEqual(FRAME_REF_BASE)
    expect(cdp.at(ref)).toMatchObject({ node: 70, frame: cdp.frames[0] })
    const inFrame = sent.find((s) => s.method === 'DOM.getNodeForLocation' && s.sessionId === 's1')
    expect(inFrame?.params).toMatchObject({ x: 30, y: 10 })
  })

  test('refAt stops at an <iframe> it has no session for', async () => {
    const { webContents } = fakeTab(({ method }) => {
      if (method === 'DOM.getNodeForLocation') return { backendNodeId: 12 }
      if (method === 'DOM.describeNode') return { node: { nodeName: 'IFRAME', frameId: 'L1' } }
      return {}
    })
    const cdp = new CdpSession(webContents)
    await cdp.attach()
    expect(await cdp.refAt(5, 5)).toBe(12)
  })
})
