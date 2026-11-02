import { describe, expect, test } from 'bun:test'
import {
  agentCommandLine,
  appendOutput,
  defaultShell,
  isAgentCommand,
  isFolderPath,
  isTerminalSize,
  quoteArg,
  sessionTitle,
  siteKey
} from './terminal-policy'

describe('defaultShell', () => {
  test('PowerShell on Windows', () => {
    expect(defaultShell('win32', {})).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
      name: 'PowerShell',
      kind: 'powershell'
    })
  })

  test('$SHELL as a login shell elsewhere, with a fallback', () => {
    expect(defaultShell('darwin', { SHELL: '/opt/homebrew/bin/fish' })).toEqual({
      file: '/opt/homebrew/bin/fish',
      args: ['-l'],
      name: 'fish',
      kind: 'posix'
    })
    expect(defaultShell('darwin', {}).file).toBe('/bin/zsh')
    expect(defaultShell('linux', { SHELL: '' }).file).toBe('/bin/bash')
  })
})

describe('quoting', () => {
  test('keeps any path one word', () => {
    expect(quoteArg(String.raw`C:\Users\O'Neil\x.json`, 'powershell')).toBe(
      String.raw`'C:\Users\O''Neil\x.json'`
    )
    expect(quoteArg("/home/a b/$HOME/it's.json", 'posix')).toBe(`'/home/a b/$HOME/it'\\''s.json'`)
  })

  test('builds the agent command line', () => {
    expect(agentCommandLine('claude', String.raw`C:\a\1.json`, 'powershell')).toBe(
      String.raw`claude --mcp-config 'C:\a\1.json'`
    )
  })

  test('agent commands are one printable line', () => {
    expect(isAgentCommand('claude')).toBe(true)
    expect(isAgentCommand('npx @anthropic-ai/claude-code')).toBe(true)
    expect(isAgentCommand('')).toBe(false)
    expect(isAgentCommand('   ')).toBe(false)
    expect(isAgentCommand('claude\nrm -rf ~')).toBe(false)
    expect(isAgentCommand('claude\u001b[2J')).toBe(false)
    expect(isAgentCommand('x'.repeat(201))).toBe(false)
    expect(isAgentCommand(42)).toBe(false)
  })
})

describe('appendOutput', () => {
  test('keeps everything under the cap', () => {
    expect(appendOutput('ab', 'cd', 10)).toBe('abcd')
  })

  test('keeps the newest output from a line start', () => {
    expect(appendOutput('line1\nline2\n', 'line3\n', 12)).toBe('line3\n')
    expect(appendOutput('', 'x'.repeat(20), 5)).toBe('xxxxx')
  })
})

test('sessionTitle numbers repeats', () => {
  expect(sessionTitle('PowerShell', [])).toBe('PowerShell')
  expect(sessionTitle('PowerShell', ['PowerShell'])).toBe('PowerShell 2')
  expect(sessionTitle('zsh', ['zsh', 'zsh 2', 'zsh 4'])).toBe('zsh 3')
})

test('siteKey is the origin of web pages only', () => {
  expect(siteKey('http://localhost:5173/cart?x=1')).toBe('http://localhost:5173')
  expect(siteKey('https://example.com/a')).toBe('https://example.com')
  expect(siteKey('nebula://home/')).toBe(null)
  expect(siteKey('about:blank')).toBe(null)
})

test('isFolderPath accepts absolute paths only', () => {
  expect(isFolderPath(process.platform === 'win32' ? 'C:\\code\\shop' : '/code/shop')).toBe(true)
  expect(isFolderPath('code/shop')).toBe(false)
  expect(isFolderPath(42)).toBe(false)
})

test('isTerminalSize', () => {
  expect(isTerminalSize(80, 24)).toBe(true)
  expect(isTerminalSize(0, 24)).toBe(false)
  expect(isTerminalSize(80, 1001)).toBe(false)
  expect(isTerminalSize(80.5, 24)).toBe(false)
  expect(isTerminalSize('80', 24)).toBe(false)
})
