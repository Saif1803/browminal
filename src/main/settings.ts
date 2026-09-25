/** Saved in settings.json. The ad blocker adds its settings here too. */
export interface Settings {
  bookmarksBarVisible: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  bookmarksBarVisible: true
}

/**
 * Reads settings.json as parsed JSON. Each setting is checked on its own: a missing or
 * wrong one gets its default, and unknown ones are dropped.
 */
export function parseSettings(raw: unknown): Settings {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    bookmarksBarVisible:
      typeof input.bookmarksBarVisible === 'boolean'
        ? input.bookmarksBarVisible
        : DEFAULT_SETTINGS.bookmarksBarVisible
  }
}
