import { FlattenMap, originalPositionFor, type TraceMap } from '@jridgewell/trace-mapping'

/**
 * Source maps: where a line of a bundled or transformed script (or stylesheet) was written, so
 * an error in `index-a1b2.js:1:9921` reads `src/components/Cart.tsx:42:9` and the agent opens
 * the right file. Pure: the maps are loaded through a function main gives (the tab's session),
 * so the lookups are tested without a page.
 */

/** The biggest map that's loaded (a big app's vendor bundle can have a 20 MB one). */
export const MAX_SOURCE_MAP_BYTES = 32 * 1024 * 1024
const MAX_MAPS = 40
const MAX_SCRIPTS = 5000

/** A place in a script as the page reports it; line and column 1-based, as editors count. */
export interface SourcePosition {
  url: string
  line: number
  column: number
}

/** The place in the original file. `source` is ready to show (a project path when it can be). */
export interface OriginalPosition {
  source: string
  line: number
  column: number
  /** The original name of what's there (a function's name before minifying), when the map has it. */
  name: string | null
}

/** A source map and what its relative sources are resolved against. */
export interface MapRef {
  url: string
  /** The map's own URL, or for an inline (data:) map the script's. */
  base: string
}

/** Loads a map's text (http(s) URLs only); rejects when it can't. */
export type LoadSourceMap = (url: string) => Promise<string>

const isHttp = (url: URL): boolean => url.protocol === 'http:' || url.protocol === 'https:'

/**
 * The map a script (or stylesheet) at `resourceUrl` points to with `sourceMapUrl` (its
 * sourceMappingURL comment, relative to the resource). Inline data: maps are fine; others must
 * be http(s) on the resource's own origin, so a page can't make Browminal fetch elsewhere.
 */
export function mapRefFor(resourceUrl: string, sourceMapUrl: string): MapRef | null {
  if (!sourceMapUrl) return null
  if (/^data:/i.test(sourceMapUrl)) return { url: sourceMapUrl, base: resourceUrl }
  try {
    const resource = new URL(resourceUrl)
    const map = new URL(sourceMapUrl, resource)
    if (!isHttp(map) || map.origin !== resource.origin) return null
    return { url: map.href, base: map.href }
  } catch {
    return null
  }
}

/** The text of a data: URL (base64 or percent-encoded), or null if it isn't one. */
export function decodeDataUrl(url: string): string | null {
  const match = /^data:([^,]*),(.*)$/is.exec(url)
  if (!match) return null
  const [, meta, data] = match
  if (/;base64$/i.test(meta)) return Buffer.from(data, 'base64').toString('utf8')
  try {
    return decodeURIComponent(data)
  } catch {
    return null
  }
}

// Bundlers' own schemes: webpack://<namespace>/./src/x.tsx, webpack-internal:///./src/x.tsx,
// turbopack:///[project]/src/x.tsx, rollup://…
const BUNDLER_SOURCE = /^(?:webpack|webpack-internal|turbopack|rollup|vite):\/\/[^/]*\//i
// POSIX folders a project lives under: a source path starting with one is a file on disk, not
// a path on the dev server.
const POSIX_ROOTS = /^\/(?:Users|home|var|tmp|private|opt|mnt|srv|workspace|workspaces|root)\//

const withoutQuery = (path: string): string => path.replace(/[?#].*$/, '')

/**
 * A source path as the agent should read it: the file on disk when the map says so
 * (C:/…/src/App.tsx), else the project path (src/App.tsx) without a bundler's prefixes or
 * a dev server's query (?t=…).
 */
export function displaySource(raw: string, resolved: string): string {
  const source = raw.trim()
  if (/^[a-z]:[\\/]/i.test(source)) return withoutQuery(source.replace(/\\/g, '/'))
  if (/^file:\/\//i.test(source)) {
    const path = decodeURIComponent(withoutQuery(source).replace(/^file:\/\/(?:localhost)?/i, ''))
    return /^\/[a-z]:\//i.test(path) ? path.slice(1) : path
  }
  if (BUNDLER_SOURCE.test(source)) {
    return withoutQuery(source.replace(BUNDLER_SOURCE, ''))
      .replace(/^\[project\]\//, '')
      .replace(/^\([^)]*\)\//, '')
      .replace(/^(?:\.\/)+/, '')
  }
  if (POSIX_ROOTS.test(source)) return withoutQuery(source)
  try {
    const url = new URL(resolved)
    if (isHttp(url)) {
      const path = decodeURIComponent(url.pathname)
      // Vite serves files outside the project root under /@fs/<absolute path>.
      const fs = /^\/@fs(\/.*)$/.exec(path)
      if (fs) return /^\/[a-z]:\//i.test(fs[1]) ? fs[1].slice(1) : fs[1]
      return path.replace(/^\/+/, '')
    }
  } catch {
    // Not a URL: show it as the map wrote it.
  }
  return withoutQuery(source).replace(/^(?:\.\/)+/, '')
}

export const formatOriginal = (position: OriginalPosition): string =>
  `${position.source}:${position.line}:${position.column}`

const positionKey = (url: string, line: number, column: number): string =>
  `${line}:${column}:${url}`

/**
 * The source maps of one tab: which map each script declared (from Debugger.scriptParsed),
 * and the maps themselves, loaded when first needed and kept (the newest MAX_MAPS).
 */
export class SourceMaps {
  /** Script URL → its map. */
  private readonly scripts = new Map<string, MapRef>()
  /** Map URL → the parsed map, or null when it couldn't be loaded or read. */
  private readonly maps = new Map<string, Promise<TraceMap | null>>()

  constructor(
    private readonly load: LoadSourceMap,
    private readonly maxBytes = MAX_SOURCE_MAP_BYTES
  ) {}

  /** A script was parsed: remember the map it declared (the newest script with a URL wins). */
  register(scriptUrl: string, sourceMapUrl: string): void {
    if (!scriptUrl) return
    const ref = mapRefFor(scriptUrl, sourceMapUrl)
    this.scripts.delete(scriptUrl)
    if (!ref) return
    this.scripts.set(scriptUrl, ref)
    if (this.scripts.size > MAX_SCRIPTS) {
      this.scripts.delete(this.scripts.keys().next().value!)
    }
  }

  /** Whether `scriptUrl` declared a map. */
  has(scriptUrl: string): boolean {
    return this.scripts.has(scriptUrl)
  }

  /** Where a place in a script was written, or null when there's no map (or it doesn't say). */
  async resolve({ url, line, column }: SourcePosition): Promise<OriginalPosition | null> {
    const ref = this.scripts.get(url)
    return ref ? this.original(ref, line, column) : null
  }

  /** Every position at once (loading each map once); look them up with `lookup`. */
  async resolveAll(positions: readonly SourcePosition[]): Promise<PositionLookup> {
    const found = new Map<string, OriginalPosition>()
    await Promise.all(
      positions.map(async (position) => {
        const original = await this.resolve(position)
        if (original) found.set(positionKey(position.url, position.line, position.column), original)
      })
    )
    return (url, line, column) => found.get(positionKey(url, line, column)) ?? null
  }

  /** A place in the resource of map `ref` (line and column 1-based). */
  async original(ref: MapRef, line: number, column: number): Promise<OriginalPosition | null> {
    const map = await this.mapFor(ref)
    if (!map || line < 1) return null
    const found = originalPositionFor(map, { line, column: Math.max(0, column - 1) })
    if (found.source === null) return null
    const index = map.resolvedSources.indexOf(found.source)
    const raw = (index >= 0 ? map.sources[index] : null) ?? found.source
    const rooted =
      map.sourceRoot && !/^[a-z][\w+.-]*:|^\//i.test(raw)
        ? `${map.sourceRoot.replace(/\/?$/, '/')}${raw}`
        : raw
    return {
      source: displaySource(rooted, found.source),
      line: found.line,
      column: found.column + 1,
      name: found.name
    }
  }

  clear(): void {
    this.scripts.clear()
    this.maps.clear()
  }

  private mapFor(ref: MapRef): Promise<TraceMap | null> {
    let map = this.maps.get(ref.url)
    if (map) {
      // Most recently used last, so the oldest is dropped first.
      this.maps.delete(ref.url)
      this.maps.set(ref.url, map)
      return map
    }
    map = this.parse(ref)
    this.maps.set(ref.url, map)
    if (this.maps.size > MAX_MAPS) this.maps.delete(this.maps.keys().next().value!)
    return map
  }

  private async parse(ref: MapRef): Promise<TraceMap | null> {
    try {
      const text = /^data:/i.test(ref.url) ? decodeDataUrl(ref.url) : await this.load(ref.url)
      if (text === null || text.length > this.maxBytes) return null
      // Some servers prefix maps with )]}' to stop them being run as script.
      const json: unknown = JSON.parse(text.replace(/^\)\]\}'[^\n]*\n/, ''))
      if (!json || typeof json !== 'object') return null
      return FlattenMap(json as Parameters<typeof FlattenMap>[0], ref.base)
    } catch {
      return null
    }
  }
}

/** A resolved position for (url, line, column), or null. */
export type PositionLookup = (url: string, line: number, column: number) => OriginalPosition | null

// "http://localhost:5173/src/App.tsx?t=1:12:5", as stack traces in text write places.
const LOCATION_IN_TEXT =
  /((?:https?|webpack-internal|webpack|file):\/\/[^\s()'"<>]+?):(\d+):(\d+)(?=$|[\s)'"<>,])/gm

/** The places a text (an error's stack) names. */
export function locationsIn(text: string): SourcePosition[] {
  return [...text.matchAll(LOCATION_IN_TEXT)].map((match) => ({
    url: match[1],
    line: Number(match[2]),
    column: Number(match[3])
  }))
}

/** `text` with each place `lookup` resolves replaced by its original file and line. */
function replacePlaces(text: string, lookup: PositionLookup): string {
  return text.replace(LOCATION_IN_TEXT, (match, url: string, line: string, column: string) => {
    const original = lookup(url, Number(line), Number(column))
    return original ? formatOriginal(original) : match
  })
}

// A minifier's names are one to three characters (a, Qe, $t1); longer ones are kept as written.
const MANGLED = /^[A-Za-z_$][\w$]{0,2}$/

/**
 * A stack frame's function name as it was written. A map has no name for a function itself, but
 * the place that called it (the caller's frame) maps to the name it was called by: `t()` in a
 * bundle is `checkout()` in Cart.tsx. Only a minified-looking name is replaced, keeping `async `
 * and `new `; `called` is the caller frame's original position (null when unknown).
 */
export function originalFunctionName(name: string, called: OriginalPosition | null): string {
  const original = called?.name
  if (!original || !/^[A-Za-z_$][\w$]*$/.test(original)) return name
  const [, prefix = '', rest] = /^(async |new )?(.*)$/s.exec(name) ?? []
  const core = (rest ?? '').replace(/ \[as [^\]]*\]$/, '')
  const last = core.slice(core.lastIndexOf('.') + 1)
  if (!MANGLED.test(last) || last === original) return name
  return `${prefix}${original}`
}

// "    at name (place)" and "    at place", as V8 writes stack lines.
const NAMED_FRAME = /^(\s*at )(.+?) \((.+?):(\d+):(\d+)\)(\s*)$/
const PLAIN_FRAME = /^\s*at (?:async )?(.+?):(\d+):(\d+)\s*$/

/**
 * `text` with each place `lookup` resolves replaced by its original file and line, and in a
 * stack written in it ("    at t (…)"), minified function names by their original ones.
 */
export function replaceLocations(text: string, lookup: PositionLookup): string {
  const lines = text.split('\n')
  // Each stack line's own place, for the line above it (its callee) to take its name from.
  const places = lines.map((line) => {
    const named = NAMED_FRAME.exec(line)
    if (named) {
      return {
        async: named[2].startsWith('async '),
        url: named[3],
        line: +named[4],
        column: +named[5]
      }
    }
    const plain = PLAIN_FRAME.exec(line)
    if (plain)
      return {
        async: /^\s*at async /.test(line),
        url: plain[1],
        line: +plain[2],
        column: +plain[3]
      }
    return null
  })
  const renamed = lines.map((line, index) => {
    const named = NAMED_FRAME.exec(line)
    const caller = places[index + 1]
    // Across an await the next frame isn't the call site.
    if (!named || !caller || caller.async) return line
    const name = originalFunctionName(named[2], lookup(caller.url, caller.line, caller.column))
    if (name === named[2]) return line
    return `${named[1]}${name} (${named[3]}:${named[4]}:${named[5]})${named[6]}`
  })
  return replacePlaces(renamed.join('\n'), lookup)
}
