import { FiltersEngine, Request, type ElectronRequestType } from '@ghostery/adblocker'
import type { DomTokens } from './adblock-policy'

/**
 * What the engine is built with: network blocking and element hiding only. No scriptlets or
 * redirect resources (they would run code from the lists in pages), no $csp headers, no
 * extended selectors and no HTML filtering.
 */
const ENGINE_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: true,
  loadCSPFilters: false,
  loadExtendedSelectors: false,
  enableHtmlFiltering: false
}

/** Parses the filter lists (the slow part: run it in a worker) into the engine's saved form. */
export function buildEngine(lists: string): Uint8Array {
  return FiltersEngine.parse(lists, ENGINE_CONFIG).serialize()
}

/**
 * An engine from buildEngine's bytes (or the cache file), or null when they aren't one: a
 * damaged file, or one saved by another version of the engine.
 */
export function loadEngine(bytes: Uint8Array): FiltersEngine | null {
  try {
    return FiltersEngine.deserialize(bytes)
  } catch {
    return null
  }
}

export interface RequestDetails {
  url: string
  /** Electron's resourceType. */
  type: string
  /** The page (or frame) that made the request. */
  sourceUrl: string
}

const REQUEST_TYPES = new Set<string>([
  'subFrame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xhr',
  'ping',
  'cspReport',
  'media',
  'webSocket',
  'other'
] satisfies ElectronRequestType[])

/** Whether the filters block this request. Pages themselves (main frames) are never blocked. */
export function shouldBlock(
  engine: FiltersEngine,
  { url, type, sourceUrl }: RequestDetails
): boolean {
  if (type === 'mainFrame') return false
  const request = Request.fromRawDetails({
    url,
    sourceUrl,
    type: (REQUEST_TYPES.has(type) ? type : 'other') as ElectronRequestType
  })
  return engine.match(request).match
}

/**
 * CSS that hides ads on the page at `url`. Without `dom`: the site's own rules and the generic
 * ones every page gets. With `dom`: the generic rules for those class names, ids and links.
 */
export function cosmeticStyles(engine: FiltersEngine, url: string, dom: DomTokens | null): string {
  const { hostname, domain } = Request.fromRawDetails({ url })
  const { active, styles } = engine.getCosmeticsFilters({
    url,
    hostname,
    domain,
    ...(dom ?? {}),
    getBaseRules: !dom,
    getRulesFromHostname: !dom,
    getRulesFromDOM: dom !== null,
    getInjectionRules: false,
    getExtendedRules: false
  })
  return active ? styles : ''
}
