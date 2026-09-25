import { MAX_PAUSED_SITES, isSite } from './adblock-policy'

export interface AdblockSettings {
  /** Off: nothing is blocked anywhere. */
  enabled: boolean
  /** Sites (see siteOf) where the user paused blocking. */
  pausedSites: string[]
}

/** Saved in settings.json. */
export interface Settings {
  bookmarksBarVisible: boolean
  adblock: AdblockSettings
}

export const DEFAULT_SETTINGS: Settings = {
  bookmarksBarVisible: true,
  adblock: { enabled: true, pausedSites: [] }
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
    adblock: parseAdblock(input.adblock)
  }
}
