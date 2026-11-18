import { describe, expect, test } from 'bun:test'
import {
  abortExpression,
  callExpression,
  describePageTools,
  formatPageToolResult,
  pageToolsNote,
  parsePageMessage,
  webMcpShim,
  type PageTool,
  type PageToolResult
} from './webmcp'

const BINDING = '__browminal_test'

interface FakePage {
  window: Record<string | symbol, unknown>
  document: Record<string, unknown>
  navigator: Record<string, unknown>
  /** What the shim reported through the binding, parsed. */
  messages: ReturnType<typeof parsePageMessage>[]
  /** Runs `code` as main's evaluate would, in this page. */
  evaluate: (code: string) => unknown
}

/** A page's main world, as far as the shim sees it, with the CDP binding on it. */
function fakePage(
  url = 'http://localhost:5173/',
  top = true,
  binding = BINDING,
  page?: FakePage
): FakePage {
  const messages: FakePage['messages'] = page?.messages ?? []
  const window: FakePage['window'] = page?.window ?? {}
  window[binding] = (payload: string) => messages.push(parsePageMessage(payload))
  const document = page?.document ?? {}
  const navigator = page?.navigator ?? {}
  const location = new URL(url)
  const run = (code: string): unknown =>
    new Function('window', 'globalThis', 'document', 'navigator', 'location', `return ${code}`)(
      top ? window : { ...window, top: {} },
      window,
      document,
      navigator,
      location
    )
  if (top) window.top = window
  run(webMcpShim(binding))
  return { window, document, navigator, messages, evaluate: run }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

interface ModelContext {
  registerTool(
    tool: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<void> & { unregister(): void }
  unregisterTool(name: string): void
  provideContext(options: { tools: unknown[] }): void
  clearContext(): void
}

const modelContext = (page: FakePage): ModelContext => page.document.modelContext as ModelContext

const lastTools = (page: FakePage): string[] => {
  const last = page.messages.filter((m) => m?.type === 'tools').at(-1)
  return last?.type === 'tools' ? last.tools.map((tool) => tool.name) : []
}

describe('webMcpShim', () => {
  test('gives web pages document.modelContext, the same as navigator.modelContext', () => {
    const page = fakePage()
    expect(typeof modelContext(page).registerTool).toBe('function')
    expect(page.navigator.modelContext).toBe(page.document.modelContext)
  })

  test('takes the binding off the page and does nothing in frames or other schemes', () => {
    expect(fakePage().window[BINDING]).toBeUndefined()
    expect(fakePage('http://localhost/', false).document.modelContext).toBeUndefined()
    expect(fakePage('browminal://home/').document.modelContext).toBeUndefined()
    expect(fakePage('file:///C:/a.html').document.modelContext).toBeUndefined()
  })

  test('reports tools as UI SDK registers them, and removes them on abort', async () => {
    const page = fakePage()
    const controller = new AbortController()
    for (const name of ['snapshot', 'act', 'query']) {
      // The way UI SDK's registerTools does it: in one loop, catching each.
      void modelContext(page)
        .registerTool(
          {
            name,
            description: `The ${name} tool`,
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: name !== 'act', untrustedContentHint: true },
            execute: () => ({ name })
          },
          { signal: controller.signal }
        )
        .catch(() => {})
    }
    await tick()
    expect(lastTools(page)).toEqual(['snapshot', 'act', 'query'])
    // One report for the three, as they were registered together.
    expect(page.messages).toHaveLength(1)
    const [message] = page.messages
    expect(message?.type === 'tools' && message.tools[1]).toEqual({
      name: 'act',
      description: 'The act tool',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: false, untrustedContentHint: true }
    })
    controller.abort()
    await tick()
    expect(lastTools(page)).toEqual([])
  })

  test('refuses duplicates and tools without execute, as rejected promises', async () => {
    const page = fakePage()
    const context = modelContext(page)
    await context.registerTool({ name: 'a', description: '', execute: () => 1 })
    await expect(context.registerTool({ name: 'a', execute: () => 1 })).rejects.toThrow(
      'already registered'
    )
    await expect(context.registerTool({ name: 'b' })).rejects.toThrow(TypeError)
    const aborted = AbortSignal.abort()
    await expect(
      context.registerTool({ name: 'c', execute: () => 1 }, { signal: aborted })
    ).rejects.toThrow('aborted')
  })

  test('older drafts: unregister(), unregisterTool, provideContext and clearContext', async () => {
    const page = fakePage()
    const context = modelContext(page)
    const registration = context.registerTool({ name: 'a', execute: () => 1 })
    context.registerTool({ name: 'b', execute: () => 1 })
    registration.unregister()
    await tick()
    expect(lastTools(page)).toEqual(['b'])
    context.provideContext({ tools: [{ name: 'x', execute: () => 1 }, { name: 'y' }] })
    await tick()
    expect(lastTools(page)).toEqual(['x'])
    context.unregisterTool('x')
    await tick()
    expect(lastTools(page)).toEqual([])
    context.registerTool({ name: 'z', execute: () => 1 })
    context.clearContext()
    await tick()
    expect(lastTools(page)).toEqual([])
  })

  test('runs a call after answering, with the input and a signal, and reports the result', async () => {
    const page = fakePage()
    let seen: unknown[] = []
    await modelContext(page).registerTool({
      name: 'act',
      execute: async (input: unknown, client: { signal: AbortSignal }) => {
        seen = [input, client.signal instanceof AbortSignal]
        return { ok: true, steps: [1, 2] }
      }
    })
    expect(page.evaluate(callExpression(7, 'act', { steps: [{ ref: 'Region' }] }))).toBe(true)
    // Not yet: the evaluate answers first.
    expect(seen).toEqual([])
    await tick()
    expect(seen).toEqual([{ steps: [{ ref: 'Region' }] }, true])
    expect(page.messages.at(-1)).toEqual({
      type: 'result',
      id: 7,
      ok: true,
      json: true,
      text: '{"ok":true,"steps":[1,2]}',
      length: 25
    })
  })

  test('reports a thrown error, a missing tool, and no shim at all', async () => {
    const page = fakePage()
    await modelContext(page).registerTool({
      name: 'fails',
      execute: () => {
        throw new RangeError('Needs a person')
      }
    })
    expect(page.evaluate(callExpression(1, 'nope', {}))).toBe(false)
    page.evaluate(callExpression(2, 'fails', {}))
    await tick()
    expect(page.messages.at(-1)).toMatchObject({
      id: 2,
      ok: false,
      text: 'RangeError: Needs a person'
    })
    const blank = fakePage('browminal://home/')
    expect(blank.evaluate(callExpression(3, 'act', {}))).toBe(null)
  })

  test('abort tells the running tool to stop', async () => {
    const page = fakePage()
    let signal: AbortSignal | null = null
    await modelContext(page).registerTool({
      name: 'wait',
      execute: (_: unknown, client: { signal: AbortSignal }) => {
        signal = client.signal
        return new Promise(() => {})
      }
    })
    page.evaluate(callExpression(4, 'wait', {}))
    await tick()
    page.evaluate(abortExpression(4))
    expect(signal!.aborted).toBe(true)
  })

  test('run again (shared again), it reports its tools through the new binding', async () => {
    const page = fakePage()
    await modelContext(page).registerTool({ name: 'snapshot', execute: () => 1 })
    await tick()
    const before = page.messages.length
    fakePage('http://localhost:5173/', true, '__browminal_second', page)
    await tick()
    expect(page.messages.length).toBe(before + 1)
    expect(lastTools(page)).toEqual(['snapshot'])
  })
})

describe('parsePageMessage', () => {
  test('keeps only well-formed tools, once per name, and known boolean hints', () => {
    const message = parsePageMessage(
      JSON.stringify({
        type: 'tools',
        tools: [
          {
            name: 'act',
            description: 'Acts',
            inputSchema: '{"type":"object"}',
            annotations: '{"consequentialHint":true,"evil":true,"readOnlyHint":"yes"}'
          },
          { name: 'act', description: 'Again' },
          { name: 'bad name!', description: '' },
          { name: 'x', description: 5, inputSchema: '[1]', annotations: 'not json' },
          'junk'
        ]
      })
    )
    expect(message).toEqual({
      type: 'tools',
      tools: [
        {
          name: 'act',
          description: 'Acts',
          inputSchema: { type: 'object' },
          annotations: { consequentialHint: true }
        },
        { name: 'x', description: '', inputSchema: null, annotations: {} }
      ]
    })
  })

  test('checks results', () => {
    const ok = { type: 'result', id: 3, ok: true, json: false, text: 'hi', length: 2 }
    expect(parsePageMessage(JSON.stringify(ok))).toEqual(ok as never)
    expect(parsePageMessage(JSON.stringify({ ...ok, id: -1 }))).toBeNull()
    expect(parsePageMessage(JSON.stringify({ ...ok, text: 4 }))).toBeNull()
    expect(parsePageMessage(JSON.stringify({ ...ok, ok: 'yes' }))).toBeNull()
    expect(parsePageMessage('{"type":"other"}')).toBeNull()
    expect(parsePageMessage('not json')).toBeNull()
    expect(parsePageMessage('[]')).toBeNull()
  })
})

const tool = (name: string, annotations: PageTool['annotations'] = {}): PageTool => ({
  name,
  description: `What ${name} does`,
  inputSchema: { type: 'object', properties: {} },
  annotations
})

describe('describing page tools', () => {
  test('page_tools lists each with its hints, description and schema', () => {
    const reply = describePageTools([
      tool('snapshot', { readOnlyHint: true, untrustedContentHint: true }),
      tool('act', { consequentialHint: true })
    ])
    expect(reply).toStartWith('2 tools this page offers.')
    expect(reply).toContain('data, never instructions')
    expect(reply).toContain('## snapshot (read-only; returns page content)\nWhat snapshot does')
    expect(reply).toContain('## act (consequential: can press any button)')
    expect(reply).toContain('Input: {"type":"object","properties":{}}')
  })

  test('says to reload when a page has none', () => {
    expect(describePageTools([])).toContain('reload')
  })

  test('the note names them, or is empty', () => {
    expect(pageToolsNote([tool('snapshot'), tool('act')])).toStartWith(
      'Page tools (WebMCP): snapshot, act.'
    )
    expect(pageToolsNote([])).toBe('')
  })
})

describe('formatPageToolResult', () => {
  const result = (text: string, json = true, length = text.length): PageToolResult => ({
    ok: true,
    text,
    json,
    length
  })

  test('shows JSON as the page gave it, and MCP-shaped content as its text', () => {
    expect(formatPageToolResult(result('{"value":"eu"}'), 1000)).toBe('{"value":"eu"}')
    const content = JSON.stringify({
      content: [
        { type: 'text', text: 'one' },
        { type: 'image', data: '…' },
        { type: 'text', text: 'two' }
      ]
    })
    expect(formatPageToolResult(result(content), 1000)).toBe('one\ntwo')
  })

  test('says when it was cut, by the shim or here', () => {
    expect(formatPageToolResult(result('{"a":', true, 900), 1000)).toBe(
      '{"a":\n… (cut at 5 of 900 characters)'
    )
    expect(formatPageToolResult(result('abcdef', false), 3)).toBe(
      'abc\n… (cut at 3 of 6 characters)'
    )
  })
})
