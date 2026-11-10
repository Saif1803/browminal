import { basename, isAbsolute } from 'path'
import { agentProgram } from '../shared/agents'
import { MAX_AGENT_COMMAND, MCP_CONFIG_PLACEHOLDER } from '../shared/types'
import { isHttpUrl } from '../shared/url'
import { mcpUrl } from './agent-policy'

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
export const MAX_FOLDER_PATH = 1024
export const MAX_REMEMBERED_FOLDERS = 200
/** Agent commands remembered for the start page, newest first. */
export const MAX_AGENT_COMMANDS = 8
export const DEFAULT_AGENT_COMMANDS: readonly string[] = ['claude']
/** Offered on the start page after the ones used before: the agents Browminal connects itself. */
export const KNOWN_AGENT_COMMANDS: readonly string[] = ['claude', 'codex']
/** Set for an agent started from the start page: the path of its MCP config file. */
export const MCP_CONFIG_ENV = 'BROWMINAL_MCP_CONFIG'

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

/** The agent's session tab: "Claude", "Codex", or the program it runs ("aider"). */
export function agentTitle(command: string): string {
  const program = agentProgram(command)
  if (program === 'claude') return 'Claude'
  if (program === 'codex') return 'Codex'
  return program || 'Agent'
}

/** How an agent reaches Browminal: its own token (see Agent.sessionToken) and config file. */
export interface AgentConnection {
  port: number
  token: string
  /** The MCP config file (an "mcpServers" entry, see mcpConfigJson), readable by the user only. */
  configPath: string
}

/**
 * The shell line that starts the agent connected to Browminal, by the program it runs:
 * - claude: `--mcp-config <file>`.
 * - codex: it reads no config file of ours, so `-c` settings carry the URL and the token. The
 *   token is the session's own, which stops working when the session ends.
 * - anything else: the command as typed, every word with {mcp-config} in it given the file's path
 *   (and quoted). The path is also in its environment (MCP_CONFIG_ENV).
 */
export function agentCommandLine(
  command: string,
  { port, token, configPath }: AgentConnection,
  kind: ShellKind
): string {
  const program = agentProgram(command)
  if (program === 'claude') return `${command} --mcp-config ${quoteArg(configPath, kind)}`
  if (program === 'codex') {
    // TOML literal strings (single quotes): no double quotes, which Windows PowerShell mangles in
    // a native program's arguments.
    const settings = [
      `mcp_servers.browminal.url='${mcpUrl(port)}'`,
      `mcp_servers.browminal.http_headers={Authorization='Bearer ${token}'}`
    ]
    return [command, ...settings.flatMap((setting) => ['-c', quoteArg(setting, kind)])].join(' ')
  }
  return command
    .split(/(\s+)/)
    .map((word) =>
      word.includes(MCP_CONFIG_PLACEHOLDER)
        ? quoteArg(word.replaceAll(MCP_CONFIG_PLACEHOLDER, configPath), kind)
        : word
    )
    .join('')
}

/**
 * The user's shell running only `line` (an agentCommandLine): nothing is typed at a prompt, and
 * the terminal exits with the agent. The shell still finds it on the PATH its profile sets.
 * PowerShell gets the line encoded, so no quoting of the command line can change it.
 */
export function agentShell(shell: Shell, line: string): Shell {
  const args =
    shell.kind === 'powershell'
      ? [
          ...shell.args,
          '-EncodedCommand',
          Buffer.from(`${line}; exit $LASTEXITCODE`, 'utf16le').toString('base64')
        ]
      : // Interactive too, so the rc files that set PATH (nvm…) are read.
        [...shell.args, '-i', '-c', `exec ${line}`]
  return { ...shell, args }
}

/** An agent command from settings: one line of printable text. */
export const isAgentCommand = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= MAX_AGENT_COMMAND &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(value)

/** `command` first, then the ones used before it, at most MAX_AGENT_COMMANDS. */
export const rememberAgentCommand = (commands: readonly string[], command: string): string[] =>
  [command, ...commands.filter((other) => other !== command)].slice(0, MAX_AGENT_COMMANDS)

/** What the start page offers: the commands used before, then the known agents not among them. */
export const agentSuggestions = (commands: readonly string[]): string[] => [
  ...commands,
  ...KNOWN_AGENT_COMMANDS.filter((known) => !commands.some((used) => agentProgram(used) === known))
]

/** A project folder as the UI shows it: its name only, never where it is on disk. */
export const folderName = (folder: string): string => basename(folder) || folder

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
