/**
 * A tab's console as agents read it: console.* calls, uncaught exceptions and the browser's own
 * messages (Log domain), from the moment the tab was shared. Pure: the CDP events come in as
 * plain objects, so the formatting is tested without a page.
 */

export const MAX_CONSOLE_ENTRIES = 1000
const MAX_ENTRY_TEXT = 4000
const MAX_STACK_FRAMES = 10

export type ConsoleLevel = 'error' | 'warning' | 'info' | 'debug'
/** Where an entry came from: the page's console, an uncaught exception, the browser, Nebula. */
export type ConsoleSource = 'console' | 'exception' | 'browser' | 'navigation'

export interface StackFrame {
  functionName: string
  url: string
  /** 1-based, as editors count. */
  line: number
  column: number
}

export interface ConsoleEntry {
  /** Grows by one per entry, across the tab's whole log: `since` asks for newer ones. */
  seq: number
  /** ms since the epoch. */
  time: number
  level: ConsoleLevel
  source: ConsoleSource
  text: string
  /** Where it was logged or thrown, when known. */
  frames: StackFrame[]
  /** Identical entries in a row are kept once and counted. */
  count: number
}

export type NewConsoleEntry = Omit<ConsoleEntry, 'seq' | 'count'>

/** A CDP Runtime.RemoteObject, as far as the console reads it. */
interface RemoteObject {
  type?: string
  subtype?: string
  className?: string
  value?: unknown
  unserializableValue?: string
  description?: string
  preview?: ObjectPreview
}

interface ObjectPreview {
  type?: string
  subtype?: string
  description?: string
  overflow?: boolean
  properties?: { name: string; type: string; subtype?: string; value?: string }[]
}

interface CdpStackTrace {
  callFrames?: { functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }[]
}

type Params = Record<string, unknown>

const asRecord = (value: unknown): Params =>
  value !== null && typeof value === 'object' ? (value as Params) : {}

function framesOf(stack: unknown): StackFrame[] {
  const frames = asRecord(stack) as CdpStackTrace
  if (!Array.isArray(frames.callFrames)) return []
  return frames.callFrames
    .filter((frame) => typeof frame?.url === 'string' && frame.url !== '')
    .slice(0, MAX_STACK_FRAMES)
    .map((frame) => ({
      functionName: String(frame.functionName ?? ''),
      url: String(frame.url),
      line: Number(frame.lineNumber ?? 0) + 1,
      column: Number(frame.columnNumber ?? 0) + 1
    }))
}

function previewText(preview: ObjectPreview): string {
  const props = preview.properties ?? []
  const value = (p: (typeof props)[number]): string =>
    p.type === 'string' ? JSON.stringify(p.value ?? '') : (p.value ?? p.type)
  const more = preview.overflow ? ', …' : ''
  if (preview.subtype === 'array') {
    const items = props.map(value).join(', ')
    return `${preview.description ?? 'Array'} [${items}${more}]`
  }
  const fields = props.map((p) => `${p.name}: ${value(p)}`).join(', ')
  const name =
    preview.description && preview.description !== 'Object' ? `${preview.description} ` : ''
  return `${name}{${fields}${more}}`
}

/** One console.log argument as DevTools would print it, on one line. */
export function formatRemoteObject(object: RemoteObject): string {
  switch (object.type) {
    case 'string':
      return String(object.value ?? '')
    case 'undefined':
      return 'undefined'
    case 'number':
    case 'bigint':
      return object.unserializableValue ?? String(object.value)
    case 'boolean':
      return String(object.value)
    case 'symbol':
    case 'function':
      return object.description ?? object.type
  }
  if (object.subtype === 'null') return 'null'
  if (object.subtype === 'error') return object.description ?? 'Error'
  if (object.subtype === 'node') return object.description ?? 'Node'
  if (object.preview) return previewText(object.preview)
  if ('value' in object) return JSON.stringify(object.value) ?? String(object.value)
  return object.description ?? object.className ?? 'Object'
}

/** console.log("%s is %d", …): fills the format specifiers of the first string argument. */
export function formatConsoleArgs(args: RemoteObject[]): string {
  if (args.length === 0) return ''
  const [first, ...rest] = args
  if (first.type !== 'string' || !String(first.value).includes('%')) {
    return args.map(formatRemoteObject).join(' ')
  }
  const queue = [...rest]
  const head = String(first.value).replace(/%([sdifoOc%])/g, (match, spec: string) => {
    if (spec === '%') return '%'
    if (queue.length === 0) return match
    const arg = queue.shift()!
    if (spec === 'c') return '' // CSS for the message: nothing to show as text
    if (spec === 'd' || spec === 'i') {
      const n = Number(arg.value)
      return Number.isNaN(n) ? 'NaN' : String(Math.trunc(n))
    }
    if (spec === 'f') return String(Number(arg.value))
    return formatRemoteObject(arg)
  })
  return [head, ...queue.map(formatRemoteObject)].join(' ')
}

const cut = (text: string): string =>
  text.length <= MAX_ENTRY_TEXT ? text : `${text.slice(0, MAX_ENTRY_TEXT)} … (cut)`

const CONSOLE_LEVELS: Record<string, ConsoleLevel> = {
  error: 'error',
  assert: 'error',
  warning: 'warning',
  debug: 'debug'
}
// Calls that print nothing worth reading.
const SILENT_CALLS = new Set(['endGroup', 'profile', 'profileEnd'])

/** Runtime.consoleAPICalled → an entry, or null for calls that print nothing. */
export function fromConsoleApiCalled(params: Params): NewConsoleEntry | null {
  const type = String(params.type ?? 'log')
  if (SILENT_CALLS.has(type)) return null
  const args = Array.isArray(params.args) ? (params.args as RemoteObject[]) : []
  let message = type === 'clear' ? 'console.clear()' : formatConsoleArgs(args)
  if (type === 'assert') message = `Assertion failed${message ? `: ${message}` : ''}`
  return {
    time: Number(params.timestamp ?? Date.now()),
    level: CONSOLE_LEVELS[type] ?? 'info',
    source: 'console',
    text: cut(message),
    frames: framesOf(params.stackTrace)
  }
}

/** Runtime.exceptionThrown → an entry. The description already has the JS stack in it. */
export function fromExceptionThrown(params: Params): NewConsoleEntry {
  const details = asRecord(params.exceptionDetails)
  const exception = asRecord(details.exception) as RemoteObject
  const prefix = String(details.text ?? 'Uncaught')
  let message: string
  if (exception.subtype === 'error' && exception.description) {
    message = `${prefix} ${exception.description}`
  } else if (details.exception) {
    message = `${prefix} ${formatRemoteObject(exception)}`
  } else {
    message = prefix
  }
  let frames = framesOf(details.stackTrace)
  if (frames.length === 0 && typeof details.url === 'string' && details.url) {
    frames = [
      {
        functionName: '',
        url: details.url,
        line: Number(details.lineNumber ?? 0) + 1,
        column: Number(details.columnNumber ?? 0) + 1
      }
    ]
  }
  return {
    time: Number(params.timestamp ?? Date.now()),
    level: 'error',
    source: 'exception',
    text: cut(message),
    frames
  }
}

const LOG_LEVELS: Record<string, ConsoleLevel> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  verbose: 'debug'
}

/** Log.entryAdded (network errors, CSP, deprecations, interventions…) → an entry. */
export function fromLogEntry(params: Params): NewConsoleEntry {
  const entry = asRecord(params.entry)
  const source = String(entry.source ?? 'other')
  let frames = framesOf(entry.stackTrace)
  if (frames.length === 0 && typeof entry.url === 'string' && entry.url) {
    frames = [
      { functionName: '', url: entry.url, line: Number(entry.lineNumber ?? 0) + 1, column: 1 }
    ]
  }
  return {
    time: Number(entry.timestamp ?? Date.now()),
    level: LOG_LEVELS[String(entry.level)] ?? 'info',
    source: 'browser',
    text: cut(`[${source}] ${String(entry.text ?? '')}`),
    frames
  }
}

/** A line in the log where the tab loaded a new page, so the agent sees what came before. */
export const navigationEntry = (url: string, time = Date.now()): NewConsoleEntry => ({
  time,
  level: 'info',
  source: 'navigation',
  text: `Navigated to ${url}`,
  frames: []
})

const sameEntry = (a: ConsoleEntry, b: NewConsoleEntry): boolean =>
  a.level === b.level &&
  a.source === b.source &&
  a.text === b.text &&
  a.frames[0]?.url === b.frames[0]?.url &&
  a.frames[0]?.line === b.frames[0]?.line

const LEVEL_RANK: Record<ConsoleLevel, number> = { error: 3, warning: 2, info: 1, debug: 0 }

export interface ConsoleQuery {
  /** The least severe level to show (default debug: everything). */
  level?: ConsoleLevel
  /** Only entries after this seq. */
  since?: number
  /** Only entries whose text (or location) contains this, case-insensitively. */
  pattern?: string
  /** The newest this many (default 50). */
  limit?: number
}

/** The newest MAX_CONSOLE_ENTRIES entries of one tab. */
export class ConsoleLog {
  private entries: ConsoleEntry[] = []
  private nextSeq = 1

  constructor(private readonly max = MAX_CONSOLE_ENTRIES) {}

  /** The seq the last entry got (0 when there's none). */
  get lastSeq(): number {
    return this.nextSeq - 1
  }

  add(entry: NewConsoleEntry): void {
    // Electron's own warnings in unpackaged builds: about Nebula, not the page.
    if (entry.frames[0]?.url.startsWith('node:electron/')) return
    const last = this.entries[this.entries.length - 1]
    if (last && sameEntry(last, entry)) {
      last.count++
      last.time = entry.time
      return
    }
    this.entries.push({ ...entry, seq: this.nextSeq++, count: 1 })
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max)
  }

  clear(): void {
    this.entries = []
  }

  query({ level = 'debug', since = 0, pattern, limit = 50 }: ConsoleQuery = {}): {
    entries: ConsoleEntry[]
    /** How many matched before the limit cut the oldest. */
    matched: number
  } {
    const needle = pattern?.toLowerCase()
    const matches = this.entries.filter(
      (entry) =>
        entry.seq > since &&
        (entry.source === 'navigation' || LEVEL_RANK[entry.level] >= LEVEL_RANK[level]) &&
        (!needle ||
          entry.text.toLowerCase().includes(needle) ||
          entry.frames.some((frame) => frame.url.toLowerCase().includes(needle)))
    )
    return { entries: matches.slice(-limit), matched: matches.length }
  }
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** Local wall-clock time with ms: 14:03:07.215. */
export function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export const frameText = (frame: StackFrame): string => `${frame.url}:${frame.line}:${frame.column}`

/** One entry as the agent reads it: a header line, then the stack for errors. */
export function formatConsoleEntry(entry: ConsoleEntry): string {
  const times = entry.count > 1 ? ` (×${entry.count})` : ''
  const head = `#${entry.seq} ${clockTime(entry.time)} [${entry.level}]${times} ${entry.text}`
  if (entry.frames.length === 0) return head
  // Exceptions carry their JS stack in the text already; elsewhere say where it came from.
  const textHasStack = /\n\s+at /.test(entry.text)
  if (textHasStack) return head
  if (entry.level !== 'error') return `${head}\n    at ${frameText(entry.frames[0])}`
  const stack = entry.frames
    .map(
      (frame) =>
        `    at ${frame.functionName ? `${frame.functionName} (${frameText(frame)})` : frameText(frame)}`
    )
    .join('\n')
  return `${head}\n${stack}`
}
