import type { AdblockEngine } from '../../native/nebula_native.node'
import type { DomTokens } from './adblock-policy'
import native from './native'

export type { AdblockEngine }

/**
 * The filter engine is Brave's adblock-rust, in our native module (native/src/adblock.rs): network
 * blocking and element hiding only. No scriptlets or redirect resources (they would run code from
 * the lists in pages), no $csp headers and no procedural filters. The lists are parsed in
 * adblock-worker.ts, which saves the engine to a file.
 */

/**
 * The engine saved in `file` (read by the native module, off the main thread), or null when
 * there's none or it isn't one: a damaged file, or one saved by another version of the engine.
 */
export async function loadEngine(file: string): Promise<AdblockEngine | null> {
  return (await native.loadAdblockEngine(file)) ?? null
}

export interface RequestDetails {
  url: string
  /** Electron's resourceType. */
  type: string
  /** The page (or frame) that made the request. */
  sourceUrl: string
  /** GET, POST… (for $method rules). */
  method?: string
}

/** Whether the filters block this request. Pages themselves (main frames) are never blocked. */
export function shouldBlock(
  engine: AdblockEngine,
  { url, type, sourceUrl, method = '' }: RequestDetails
): boolean {
  return engine.shouldBlock(url, type, sourceUrl, method)
}

/**
 * CSS that hides ads on the page at `url`. Without `dom`: the site's own rules and the generic
 * ones every page gets. With `dom`: the generic rules for those class names and ids.
 */
export function cosmeticStyles(engine: AdblockEngine, url: string, dom: DomTokens | null): string {
  return engine.cosmeticStyles(url, dom)
}
