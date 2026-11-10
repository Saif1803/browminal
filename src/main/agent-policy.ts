import { isHttpUrl } from '../shared/url'

/** What the agent server is told about a tab. */
export interface AgentTab {
  id: number
  /** As the user sees it (an error page shows the URL that failed). */
  url: string
  title: string
  isActive: boolean
  /** Whether agents may see and act on it. */
  shared: boolean
}

export const DEFAULT_AGENT_PORT = 9339
/** Ports the server tries when the saved one is taken: the saved one and the next few. */
export const AGENT_PORT_ATTEMPTS = 10
export const MAX_AGENT_TEXT = 100_000

export const isAgentPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535

/**
 * Whether the agent may read or act in the page loaded in a tab: web pages and blank pages only.
 * `rawUrl` is the webContents' own URL, so browminal:// pages (home, error pages) are never touched.
 */
export const canInspect = (rawUrl: string): boolean => isHttpUrl(rawUrl) || rawUrl === 'about:blank'

/**
 * The tab a tool acts on when it names none: the one the agent used last, if it's still shared;
 * else `preferredId` (the tab of the terminal the agent runs in), if shared; else the active tab,
 * if shared; else the only shared tab. Null when that's ambiguous or none.
 */
export function defaultAgentTab(
  tabs: readonly AgentTab[],
  lastId: number | null,
  preferredId: number | null = null
): number | null {
  const shared = tabs.filter((tab) => tab.shared)
  for (const id of [lastId, preferredId]) {
    if (id !== null && shared.some((tab) => tab.id === id)) return id
  }
  const active = shared.find((tab) => tab.isActive)
  if (active) return active.id
  return shared.length === 1 ? shared[0].id : null
}

/** Cuts `text` to `max` characters and says so, so the agent knows it didn't see everything. */
export function truncate(text: string, max = MAX_AGENT_TEXT): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… (cut at ${max} of ${text.length} characters)`
}

/** A value a page script returned, as the agent reads it. */
export function formatValue(value: unknown, max = MAX_AGENT_TEXT): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return truncate(value, max)
  return truncate(JSON.stringify(value, null, 2) ?? String(value), max)
}

/** The list_tabs reply: one line per tab. */
export function describeTabs(tabs: readonly AgentTab[]): string {
  const visible = tabs.filter((tab) => tab.shared)
  const lines = visible.map((tab) => {
    const marks = [tab.isActive && 'active'].filter(Boolean)
    const title = tab.title && tab.title !== tab.url ? `${tab.title} — ` : ''
    return `[tab ${tab.id}]${marks.length ? ` (${marks.join(', ')})` : ''} ${title}${tab.url}`
  })
  const hidden = tabs.length - visible.length
  if (hidden > 0) {
    lines.push(
      `${hidden} more tab${hidden === 1 ? ' is' : 's are'} open but not shared. ` +
        'The user shares a tab with the agent button in Browminal’s toolbar (or Ctrl+Shift+A); ' +
        'new_tab opens a shared one.'
    )
  }
  return lines.length ? lines.join('\n') : 'No tabs are open.'
}

/** The size to scale a screenshot to: no wider than `maxWidth`, aspect kept. */
export function scaledSize(
  width: number,
  height: number,
  maxWidth: number
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height }
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) }
}

export const mcpUrl = (port: number): string => `http://127.0.0.1:${port}/mcp`

/** The line that adds Browminal to Claude Code, for every project. */
export const claudeAddCommand = (port: number, token: string): string =>
  `claude mcp add --scope user --transport http browminal ${mcpUrl(port)} ` +
  `--header "Authorization: Bearer ${token}"`

/** The same for agents configured with JSON (an "mcpServers" entry). */
export function mcpConfigJson(port: number, token: string): string {
  const headers = { Authorization: `Bearer ${token}` }
  return JSON.stringify(
    { mcpServers: { browminal: { type: 'http', url: mcpUrl(port), headers } } },
    null,
    2
  )
}
