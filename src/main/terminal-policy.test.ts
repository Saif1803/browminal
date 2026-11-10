import { describe, expect, test } from 'bun:test'
import {
  agentCommandLine,
  agentShell,
  agentSuggestions,
  agentTitle,
  appendOutput,
  defaultShell,
  folderName,
  isAgentCommand,
  isFolderPath,
  isTerminalSize,
  quoteArg,
  rememberAgentCommand,
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

  const connection = { port: 9340, token: 'tok', configPath: String.raw`C:\a b\1.json` }

  test('connects Claude Code with its config file', () => {
    expect(agentCommandLine('claude', connection, 'powershell')).toBe(
      String.raw`claude --mcp-config 'C:\a b\1.json'`
    )
    expect(agentCommandLine('claude --model opus', connection, 'powershell')).toBe(
      String.raw`claude --model opus --mcp-config 'C:\a b\1.json'`
    )
  })

  test('connects Codex with -c settings, in TOML literal strings', () => {
    expect(agentCommandLine('codex', connection, 'powershell')).toBe(
      "codex -c 'mcp_servers.browminal.url=''http://127.0.0.1:9340/mcp''' " +
        "-c 'mcp_servers.browminal.http_headers={Authorization=''Bearer tok''}'"
    )
    expect(agentCommandLine('codex', connection, 'posix')).toBe(
      `codex -c 'mcp_servers.browminal.url='\\''http://127.0.0.1:9340/mcp'\\''' ` +
        `-c 'mcp_servers.browminal.http_headers={Authorization='\\''Bearer tok'\\''}'`
    )
  })

  test('gives any other agent the config path where it asks for it', () => {
    expect(agentCommandLine('aider --yes', connection, 'powershell')).toBe('aider --yes')
    expect(
      agentCommandLine('copilot --additional-mcp-config @{mcp-config}', connection, 'powershell')
    ).toBe(String.raw`copilot --additional-mcp-config '@C:\a b\1.json'`)
    expect(agentCommandLine('my-agent  --mcp={mcp-config}', connection, 'posix')).toBe(
      String.raw`my-agent  '--mcp=C:\a b\1.json'`
    )
  })

  test('runs the agent as the shell command, typing nothing', () => {
    const powershell = defaultShell('win32', {})
    const ps = agentShell(powershell, String.raw`claude --mcp-config 'C:\a b\1.json'`)
    expect(ps.args.slice(0, 2)).toEqual(['-NoLogo', '-EncodedCommand'])
    expect(Buffer.from(ps.args[2]!, 'base64').toString('utf16le')).toBe(
      String.raw`claude --mcp-config 'C:\a b\1.json'; exit $LASTEXITCODE`
    )
    expect(ps.file).toBe('powershell.exe')

    const zsh = defaultShell('darwin', { SHELL: '/bin/zsh' })
    expect(agentShell(zsh, "claude --mcp-config '/u/1.json'").args).toEqual([
      '-l',
      '-i',
      '-c',
      "exec claude --mcp-config '/u/1.json'"
    ])
  })

  test('names the session after the program a command runs', () => {
    expect(agentTitle('codex --model o3')).toBe('Codex')
    expect(agentTitle('claude')).toBe('Claude')
    expect(agentTitle('npx aider')).toBe('npx')
  })

  test('remembers agent commands newest first, and suggests the known ones', () => {
    expect(rememberAgentCommand(['claude', 'codex'], 'codex')).toEqual(['codex', 'claude'])
    expect(rememberAgentCommand(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'i')).toHaveLength(8)
    expect(agentSuggestions(['aider'])).toEqual(['aider', 'claude', 'codex'])
    expect(agentSuggestions(['claude --model opus'])).toEqual(['claude --model opus', 'codex'])
  })

  test('shows a folder by its name only', () => {
    expect(folderName('/home/me/projects/shop')).toBe('shop')
    expect(folderName('/')).toBe('/')
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
  expect(siteKey('browminal://home/')).toBe(null)
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
