import {
  formatOriginal,
  locationsIn,
  type OriginalPosition,
  type SourcePosition
} from './source-maps'

/**
 * Where an element is written in the project's source, from what a framework's dev build keeps
 * on DOM nodes: React's fiber (_debugSource up to React 18, _debugStack from React 19), Vue's
 * component (__file) and Svelte's __svelte_meta. Pure: the page's answer comes in as a plain
 * value and is checked here, since a page can put anything on its nodes.
 */

const MAX_NAME = 200
const MAX_FILE = 1000
const MAX_STACK = 4000

export type Framework = 'react' | 'vue' | 'svelte'

export interface ComponentSource {
  framework: Framework
  /** The component that rendered the element ("Cart"), when known. */
  component: string | null
  /** A file path as the dev build wrote it (often absolute), or null. */
  file: string | null
  /** 1-based, or null when only the file is known. */
  line: number | null
  column: number | null
  /** React 19: the stack where the element was created, to resolve through source maps. */
  stack: string | null
}

/**
 * Runs on the element in the page's main world (frameworks keep their data there, not in an
 * isolated world): the nearest element up the tree that a framework knows about.
 */
export const COMPONENT_SOURCE = `function () {
  const str = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null)
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null)
  const nameOf = (type) =>
    type && (typeof type === 'object' || typeof type === 'function')
      ? str(type.displayName || type.name || type.__name, ${MAX_NAME})
      : null
  let el = this.nodeType === Node.ELEMENT_NODE ? this : this.parentElement
  for (let depth = 0; el && depth < 40; el = el.parentElement, depth++) {
    const svelte = el.__svelte_meta && el.__svelte_meta.loc
    if (svelte) {
      return { framework: 'svelte', component: null, file: str(svelte.file, ${MAX_FILE}),
        line: num(svelte.line), column: num(svelte.column), stack: null,
        zeroBasedLine: 'char' in svelte }
    }
    const fiberKey = Object.keys(el).find((key) => key.startsWith('__reactFiber$'))
    if (fiberKey) {
      const fiber = el[fiberKey] || {}
      const owner = fiber._debugOwner
      const component = owner ? nameOf(owner.type) || str(owner.name, ${MAX_NAME}) : null
      const source = fiber._debugSource
      if (source) {
        return { framework: 'react', component, file: str(source.fileName, ${MAX_FILE}),
          line: num(source.lineNumber), column: num(source.columnNumber), stack: null }
      }
      const stack = fiber._debugStack
      return { framework: 'react', component, file: null, line: null, column: null,
        stack: stack && typeof stack.stack === 'string' ? stack.stack.slice(0, ${MAX_STACK}) : null }
    }
    const vue = el.__vueParentComponent
    if (vue && vue.type) {
      return { framework: 'vue', component: nameOf(vue.type), file: str(vue.type.__file, ${MAX_FILE}),
        line: null, column: null, stack: null }
    }
    const vue2 = el.__vue__ && el.__vue__.$options
    if (vue2) {
      return { framework: 'vue', component: str(vue2.name, ${MAX_NAME}), file: str(vue2.__file, ${MAX_FILE}),
        line: null, column: null, stack: null }
    }
  }
  return null
}`

const FRAMEWORKS: readonly Framework[] = ['react', 'vue', 'svelte']

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 10_000_000
    ? value
    : null

/** The page's answer to COMPONENT_SOURCE, checked; null when it's none or makes no sense. */
export function parseComponentSource(value: unknown): ComponentSource | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const framework = FRAMEWORKS.find((name) => name === raw.framework)
  if (!framework) return null
  let line = count(raw.line)
  let column = count(raw.column)
  // Svelte 4 counts lines and columns from 0, Svelte 5 lines from 1 and columns from 0.
  if (framework === 'svelte') {
    if (line !== null && raw.zeroBasedLine === true) line++
    if (column !== null) column++
  }
  if (line === 0) line = null
  if (line === null || column === 0) column = null
  const source: ComponentSource = {
    framework,
    component: text(raw.component, MAX_NAME),
    file: text(raw.file, MAX_FILE),
    line,
    column,
    stack: text(raw.stack, MAX_STACK)
  }
  if (!source.file) source.line = source.column = null
  return source.component || source.file || source.stack ? source : null
}

// Frames of the framework itself, not of the app: skipped to find where the element is written.
const FRAMEWORK_FRAME =
  /\/node_modules\/|\/\.vite\/deps\/|react-dom|jsx-dev-runtime|react-stack-top-frame/

/** React 19's _debugStack: the first frame in the app's own code (where the JSX is). */
export function appFrame(stack: string): SourcePosition | null {
  for (const line of stack.split('\n')) {
    const [position] = locationsIn(line)
    if (position && !FRAMEWORK_FRAME.test(position.url)) return position
  }
  return null
}

const FRAMEWORK_NAMES: Record<Framework, string> = { react: 'React', vue: 'Vue', svelte: 'Svelte' }

/**
 * One line for the agent: "src/components/Cart.tsx:42:9 (React, in <Cart>)". `fromStack` is
 * `appFrame(stack)` resolved through the page's source maps; `rawFrame` the same unresolved.
 */
export function formatComponentSource(
  source: ComponentSource,
  fromStack: OriginalPosition | null = null,
  rawFrame: SourcePosition | null = null
): string {
  const where = [FRAMEWORK_NAMES[source.framework]]
  if (source.component) where.push(`in <${source.component}>`)
  const context = `(${where.join(', ')})`
  if (source.file) {
    const line =
      source.line === null
        ? ''
        : `:${source.line}${source.column === null ? '' : `:${source.column}`}`
    return `${source.file.replace(/\\/g, '/')}${line} ${context}`
  }
  if (fromStack) return `${formatOriginal(fromStack)} ${context}`
  if (rawFrame)
    return `${rawFrame.url}:${rawFrame.line}:${rawFrame.column} ${context} (no source map)`
  return `unknown file ${context}: the dev build didn’t record where it’s written`
}
