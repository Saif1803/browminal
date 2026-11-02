import { isAbsolute } from 'path'
import { isHttpUrl } from '../shared/url'

export type ShellKind = 'powershell' | 'posix'

export interface Shell {
  file: string
  args: string[]
  /** Shown on the session's tab. */
  name: string
  kind: ShellKind
}

/** Output kept per session, replayed when the terminal view (re)loads. */
export const MAX_OUTPUT_BUFFER = 256 * 1024
/** One input message (a paste) at most. */
export const MAX_TERMINAL_INPUT = 64 * 1024
export const MAX_AGENT_COMMAND = 200
export const MAX_FOLDER_PATH = 1024
export const MAX_REMEMBERED_FOLDERS = 200
export const DEFAULT_AGENT_COMMAND = 'claude'

/**
 * The user's shell: Windows PowerShell on Windows; elsewhere $SHELL as a login shell, so it has
 * the PATH a terminal app would (apps started from the Dock or a launcher don't).
 */
export function defaultShell(platform: string, env: Record<string, string | undefined>): Shell {
  if (platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo'], name: 'PowerShell', kind: 'powershell' }
  }
  const file = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { file, args: ['-l'], name: file.split('/').pop() || 'shell', kind: 'posix' }
}

/** `arg` as one word for the shell, whatever it contains. */
export function quoteArg(arg: string, kind: ShellKind): string {
  if (kind === 'powershell') return `'${arg.replace(/'/g, "''")}'`
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/** The line typed into a terminal to start the agent connected to Nebula. */
export function agentCommandLine(command: string, configPath: string, kind: ShellKind): string {
  return `${command} --mcp-config ${quoteArg(configPath, kind)}`
}

/** An agent command from settings: one line of printable text. */
export const isAgentCommand = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= MAX_AGENT_COMMAND &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(value)

/** Adds `data` to a session's buffer, keeping the newest MAX output from a line start. */
export function appendOutput(buffer: string, data: string, max = MAX_OUTPUT_BUFFER): string {
  const next = buffer + data
  if (next.length <= max) return next
  const cut = next.length - max
  const lineStart = next.indexOf('\n', cut)
  return next.slice(lineStart === -1 ? cut : lineStart + 1)
}

/** "PowerShell", then "PowerShell 2", "PowerShell 3"… for the next session's tab. */
export function sessionTitle(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name
  let n = 2
  while (taken.includes(`${name} ${n}`)) n++
  return `${name} ${n}`
}

/** The key a project folder is remembered under: the page's origin (http://localhost:5173). */
export function siteKey(url: string): string | null {
  if (!isHttpUrl(url)) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export const isFolderPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_FOLDER_PATH && isAbsolute(value)

export const isTerminalSize = (cols: unknown, rows: unknown): boolean =>
  [cols, rows].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 1000)
