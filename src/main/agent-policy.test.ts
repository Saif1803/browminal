import { describe, expect, test } from 'bun:test'
import {
  canInspect,
  claudeAddCommand,
  defaultAgentTab,
  describeTabs,
  formatValue,
  isAgentPort,
  mcpConfigJson,
  parseTerminalHeader,
  scaledSize,
  truncate,
  type AgentTab
} from './agent-policy'

const tab = (id: number, extra: Partial<AgentTab> = {}): AgentTab => ({
  id,
  url: `https://example.com/${id}`,
  title: `Page ${id}`,
  isActive: false,
  shared: true,
  ...extra
})

describe('canInspect', () => {
  test('web and blank pages only', () => {
    expect(canInspect('https://example.com/')).toBe(true)
    expect(canInspect('http://localhost:5173/')).toBe(true)
    expect(canInspect('about:blank')).toBe(true)
    expect(canInspect('browminal://home/')).toBe(false)
    expect(canInspect('browminal://error/?code=X&url=https%3A%2F%2Fexample.com')).toBe(false)
    expect(canInspect('file:///C:/secret.txt')).toBe(false)
    expect(canInspect('')).toBe(false)
  })
})

describe('defaultAgentTab', () => {
  test('the tab the agent used last, while it stays shared', () => {
    expect(defaultAgentTab([tab(1, { isActive: true }), tab(2)], 2)).toBe(2)
    expect(defaultAgentTab([tab(1, { isActive: true }), tab(2, { shared: false })], 2)).toBe(1)
  })

  test('else the tab of the terminal the agent runs in, if shared', () => {
    expect(defaultAgentTab([tab(1, { isActive: true }), tab(2)], null, 2)).toBe(2)
    expect(defaultAgentTab([tab(1, { isActive: true }), tab(2)], 1, 2)).toBe(1)
    expect(defaultAgentTab([tab(1, { isActive: true }), tab(2, { shared: false })], null, 2)).toBe(
      1
    )
  })

  test('else the active tab if shared, else the only shared tab', () => {
    expect(defaultAgentTab([tab(1), tab(2, { isActive: true })], null)).toBe(2)
    expect(defaultAgentTab([tab(1), tab(2, { isActive: true, shared: false })], null)).toBe(1)
    expect(defaultAgentTab([tab(1), tab(2), tab(3, { isActive: true, shared: false })], null)).toBe(
      null
    )
    expect(defaultAgentTab([tab(1, { shared: false })], null)).toBe(null)
    expect(defaultAgentTab([], 4)).toBe(null)
  })
})

describe('describeTabs', () => {
  test('lists shared tabs and counts the others without naming them', () => {
    const text = describeTabs([
      tab(1, { isActive: true }),
      tab(2, { shared: false, title: 'My bank' }),
      tab(3, { title: '' })
    ])
    expect(text).toContain('[tab 1] (active) Page 1 — https://example.com/1')
    expect(text).toContain('[tab 3] https://example.com/3')
    expect(text).toContain('1 more tab is open but not shared')
    expect(text).not.toContain('bank')
    expect(text).not.toContain('example.com/2')
  })

  test('says when nothing is open', () => {
    expect(describeTabs([])).toBe('No tabs are open.')
    expect(describeTabs([tab(1, { shared: false }), tab(2, { shared: false })])).toStartWith(
      '2 more tabs are open'
    )
  })
})

describe('truncate and formatValue', () => {
  test('cuts long text and says where', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello world', 5)).toBe('hello\n… (cut at 5 of 11 characters)')
  })

  test('formats values a page script returned', () => {
    expect(formatValue(undefined)).toBe('undefined')
    expect(formatValue(null)).toBe('null')
    expect(formatValue('text')).toBe('text')
    expect(formatValue(42)).toBe('42')
    expect(formatValue({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}')
    expect(formatValue('x'.repeat(20), 10)).toStartWith('xxxxxxxxxx\n… (cut at 10')
  })
})

test('scaledSize keeps the aspect ratio and never upscales', () => {
  expect(scaledSize(800, 600, 1280)).toEqual({ width: 800, height: 600 })
  expect(scaledSize(2560, 1600, 1280)).toEqual({ width: 1280, height: 800 })
  expect(scaledSize(3000, 1, 1000)).toEqual({ width: 1000, height: 1 })
})

test('isAgentPort accepts unprivileged ports only', () => {
  expect(isAgentPort(9339)).toBe(true)
  expect(isAgentPort(1024)).toBe(true)
  expect(isAgentPort(80)).toBe(false)
  expect(isAgentPort(65536)).toBe(false)
  expect(isAgentPort(9339.5)).toBe(false)
  expect(isAgentPort('9339')).toBe(false)
})

test('parseTerminalHeader accepts positive ids only', () => {
  expect(parseTerminalHeader('3')).toBe(3)
  expect(parseTerminalHeader(undefined)).toBe(null)
  for (const bad of ['', '0', '-1', '1.5', ' 3', '3,4', '12345678901']) {
    expect(parseTerminalHeader(bad)).toBe(null)
  }
})

test('connection instructions carry the port and token', () => {
  expect(JSON.parse(mcpConfigJson(9340, 'abc', 7)).mcpServers.browminal.headers).toEqual({
    Authorization: 'Bearer abc',
    'x-browminal-terminal': '7'
  })
  expect(claudeAddCommand(9340, 'abc')).toBe(
    'claude mcp add --scope user --transport http browminal http://127.0.0.1:9340/mcp ' +
      '--header "Authorization: Bearer abc"'
  )
  expect(JSON.parse(mcpConfigJson(9340, 'abc'))).toEqual({
    mcpServers: {
      browminal: {
        type: 'http',
        url: 'http://127.0.0.1:9340/mcp',
        headers: { Authorization: 'Bearer abc' }
      }
    }
  })
})
