import { describe, expect, test } from 'bun:test'
import { agentBrand, agentProgram } from './agents'

describe('agents', () => {
  test('knows the program a command runs', () => {
    expect(agentProgram('claude')).toBe('claude')
    expect(agentProgram(String.raw`  C:\tools\Codex.EXE --full-auto`)).toBe('codex')
    expect(agentProgram('"/opt/my agent/claude" -c')).toBe('claude')
    expect(agentProgram('/usr/local/bin/claude.cmd')).toBe('claude')
  })

  test('knows Claude Code and Codex by their program', () => {
    expect(agentBrand('claude --model opus')).toBe('claude')
    expect(agentBrand(String.raw`C:\tools\codex.exe`)).toBe('codex')
    expect(agentBrand('npx aider')).toBeNull()
    expect(agentBrand('')).toBeNull()
  })
})
