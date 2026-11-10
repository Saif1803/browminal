/** Agents Browminal knows by name: it connects them itself and draws them with their own marks. */
export type AgentBrand = 'claude' | 'codex'

/**
 * The program an agent command runs, lower case, without its folder or Windows extension:
 * "claude" for `C:\tools\claude.exe --model opus`.
 */
export function agentProgram(command: string): string {
  const trimmed = command.trim()
  // A quoted program path may have spaces: "C:\Program Files\…\claude.exe" --model opus
  const quoted = /^(["'])(.*?)\1/.exec(trimmed)
  const first = quoted ? quoted[2] : (trimmed.split(/\s+/)[0] ?? '')
  const name = first.split(/[\\/]/).pop() ?? ''
  return name.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

/** Claude Code or Codex, from the command that runs it; null for any other agent. */
export function agentBrand(command: string): AgentBrand | null {
  const program = agentProgram(command)
  return program === 'claude' || program === 'codex' ? program : null
}
