import { MAX_PAUSED_SITES, isSite } from './adblock-policy'
import { DEFAULT_AGENT_PORT, isAgentPort } from './agent-policy'
import { isSearchEngine, type SearchEngine } from '../shared/url'
import {
  isPanelDock,
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_DEFAULT_WIDTH,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
  type PanelDock
} from '../shared/layout'
import {
  DEFAULT_AGENT_COMMANDS,
  isAgentCommand,
  isFolderPath,
  MAX_AGENT_COMMANDS,
  MAX_REMEMBERED_FOLDERS,
  siteKey
} from './terminal-policy'

export interface AdblockSettings {
  /** Off: nothing is blocked anywhere. */
  enabled: boolean
  /** Sites (see siteOf) where the user paused blocking. */
  pausedSites: string[]
}

export interface AgentSettings {
  /** On: the agent server listens on loopback and agents can act on shared tabs. */
  enabled: boolean
  /** The port to try first; the next free one is used if it is taken. */
  port: number
  /** Every tab is shared, not only the ones the user shared. */
  shareAll: boolean
}

export interface TerminalSettings {
  /** Under the page or to its right. */
  dock: PanelDock
  /** The panel's height in px at the bottom, header included. */
  height: number
  /** The panel's width in px on the right. */
  width: number
  /** Project folders by site (origin): new terminals for that site start there. */
  folders: Record<string, string>
  /** Agent commands the start page offers (claude, codex, any other), the last one used first. */
  agentCommands: string[]
}

/** What a launch opens: the tabs that were open last time, or one start page. */
export type Startup = 'restore' | 'home'

const isStartup = (value: unknown): value is Startup => value === 'restore' || value === 'home'

/** Saved in settings.json. */
export interface Settings {
  bookmarksBarVisible: boolean
  startup: Startup
  /** What the address bar searches with. */
  searchEngine: SearchEngine
  /** Visited pages are remembered (history.json) and suggested in the address bar. */
  keepHistory: boolean
  adblock: AdblockSettings
  agent: AgentSettings
  terminal: TerminalSettings
}

export const DEFAULT_SETTINGS: Settings = {
  bookmarksBarVisible: true,
  startup: 'restore',
  searchEngine: 'google',
  keepHistory: true,
  adblock: { enabled: true, pausedSites: [] },
  agent: { enabled: false, port: DEFAULT_AGENT_PORT, shareAll: false },
  terminal: {
    dock: 'bottom',
    height: TERMINAL_DEFAULT_HEIGHT,
    width: TERMINAL_DEFAULT_WIDTH,
    folders: {},
    agentCommands: [...DEFAULT_AGENT_COMMANDS]
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function parseAdblock(raw: unknown): AdblockSettings {
  const input = asRecord(raw)
  const defaults = DEFAULT_SETTINGS.adblock
  const sites = Array.isArray(input.pausedSites) ? input.pausedSites.filter(isSite) : []
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled,
    pausedSites: [...new Set(sites)].slice(0, MAX_PAUSED_SITES)
  }
}

function parseAgent(raw: unknown): AgentSettings {
  const input = asRecord(raw)
  const defaults = DEFAULT_SETTINGS.agent
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled,
    port: isAgentPort(input.port) ? input.port : defaults.port,
    shareAll: typeof input.shareAll === 'boolean' ? input.shareAll : defaults.shareAll
  }
}

const MAX_TERMINAL_SIZE = 4000

const sizeOr = (value: unknown, min: number, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= MAX_TERMINAL_SIZE
    ? value
    : fallback

/** The saved agent commands; an older file's single `agentCommand` becomes the list. */
function parseAgentCommands(input: Record<string, unknown>): string[] {
  const saved: unknown[] = Array.isArray(input.agentCommands)
    ? input.agentCommands
    : [input.agentCommand]
  const commands = [...new Set(saved.filter(isAgentCommand))].slice(0, MAX_AGENT_COMMANDS)
  return commands.length ? commands : [...DEFAULT_AGENT_COMMANDS]
}

function parseTerminal(raw: unknown): TerminalSettings {
  const input = asRecord(raw)
  const defaults = DEFAULT_SETTINGS.terminal
  const folders = Object.entries(asRecord(input.folders))
    .filter(([site, folder]) => siteKey(site) === site && isFolderPath(folder))
    .slice(0, MAX_REMEMBERED_FOLDERS)
  return {
    dock: isPanelDock(input.dock) ? input.dock : defaults.dock,
    height: sizeOr(input.height, TERMINAL_MIN_HEIGHT, defaults.height),
    width: sizeOr(input.width, TERMINAL_MIN_WIDTH, defaults.width),
    folders: Object.fromEntries(folders) as Record<string, string>,
    agentCommands: parseAgentCommands(input)
  }
}

/**
 * Reads settings.json as parsed JSON. Each setting is checked on its own: a missing or
 * wrong one gets its default, and unknown ones are dropped.
 */
export function parseSettings(raw: unknown): Settings {
  const input = asRecord(raw)
  return {
    bookmarksBarVisible:
      typeof input.bookmarksBarVisible === 'boolean'
        ? input.bookmarksBarVisible
        : DEFAULT_SETTINGS.bookmarksBarVisible,
    startup: isStartup(input.startup) ? input.startup : DEFAULT_SETTINGS.startup,
    searchEngine: isSearchEngine(input.searchEngine)
      ? input.searchEngine
      : DEFAULT_SETTINGS.searchEngine,
    keepHistory:
      typeof input.keepHistory === 'boolean' ? input.keepHistory : DEFAULT_SETTINGS.keepHistory,
    adblock: parseAdblock(input.adblock),
    agent: parseAgent(input.agent),
    terminal: parseTerminal(input.terminal)
  }
}
