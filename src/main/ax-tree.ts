/** A value in Chromium's accessibility tree (Accessibility.getFullAXTree). */
interface AXValue {
  type: string
  value?: unknown
}

/** One node as Accessibility.getFullAXTree returns it (the fields read here). */
export interface AXNode {
  nodeId: string
  ignored: boolean
  role?: AXValue
  name?: AXValue
  value?: AXValue
  properties?: { name: string; value: AXValue }[]
  childIds?: string[]
  backendDOMNodeId?: number
}

export interface AXTreeOptions {
  /** Only controls people use (buttons, links, fields…), as a flat list. */
  interactiveOnly?: boolean
  /** Start at this element (a ref from an earlier read) instead of the page. */
  rootRef?: number
  /** Levels below the root to include. */
  maxDepth?: number
  maxChars?: number
}

export const DEFAULT_AX_MAX_CHARS = 40_000
const MAX_NAME = 200

/** Roles people act on. Always shown, named or not. */
export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'slider',
  'spinbutton',
  'treeitem'
])

/** Roles that give the page its shape. Shown even without a name. */
const STRUCTURE_ROLES = new Set([
  'RootWebArea',
  'heading',
  'list',
  'listitem',
  'table',
  'row',
  'cell',
  'gridcell',
  'columnheader',
  'rowheader',
  'form',
  'navigation',
  'main',
  'banner',
  'contentinfo',
  'complementary',
  'dialog',
  'alertdialog',
  'alert',
  'menu',
  'menubar',
  'tablist',
  'tabpanel',
  'tree',
  'grid',
  'article',
  'image',
  'img'
])

/** Never shown (their text is already in their parent's StaticText). */
const HIDDEN_ROLES = new Set(['InlineTextBox', 'LineBreak'])

/** States worth telling the agent, in this order. */
const STATES = [
  'focused',
  'disabled',
  'checked',
  'pressed',
  'selected',
  'expanded',
  'required',
  'invalid',
  'level'
]

const text = (value: AXValue | undefined): string =>
  value?.value === undefined || value.value === null
    ? ''
    : String(value.value).replace(/\s+/g, ' ').trim()

const clip = (value: string): string =>
  value.length > MAX_NAME ? `${value.slice(0, MAX_NAME)}…` : value

function states(node: AXNode): string[] {
  const found: string[] = []
  for (const state of STATES) {
    const property = node.properties?.find((p) => p.name === state)
    if (!property) continue
    const value = property.value.value
    if (state === 'level') found.push(`level=${value}`)
    else if (state === 'invalid') {
      if (value && value !== 'false') found.push('invalid')
    } else if (value === true || value === 'true') found.push(state)
    else if (value === 'mixed') found.push(`${state}=mixed`)
    else if (state === 'expanded' && (value === false || value === 'false')) found.push('collapsed')
  }
  return found
}

/** One line for a node: role "name": value [states] [ref=N]. */
function describe(node: AXNode, role: string): string {
  const name = clip(text(node.name))
  const value = clip(text(node.value))
  const label = role === 'RootWebArea' ? 'page' : role === 'StaticText' ? 'text' : role
  let line = name ? `${label} "${name}"` : label
  if (value && value !== name) line += `: ${JSON.stringify(value)}`
  const marks = states(node)
  if (marks.length) line += ` [${marks.join(', ')}]`
  if (node.backendDOMNodeId !== undefined) line += ` [ref=${node.backendDOMNodeId}]`
  return line
}

/**
 * The accessibility tree as compact text, one element per line, indented by nesting. Each line
 * ends with a ref (the element's backend DOM node id) that the agent passes back to act on it.
 * Wrappers without a name are left out (their children move up), and so is text that only
 * repeats its parent's name.
 */
export function formatAXTree(nodes: readonly AXNode[], options: AXTreeOptions = {}): string {
  const {
    interactiveOnly = false,
    rootRef,
    maxDepth = Infinity,
    maxChars = DEFAULT_AX_MAX_CHARS
  } = options
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const root =
    rootRef === undefined ? nodes[0] : nodes.find((node) => node.backendDOMNodeId === rootRef)
  if (!root) {
    return rootRef === undefined
      ? 'The page has no content yet.'
      : `No element with ref=${rootRef} (the page changed?). Call read_page again.`
  }

  const lines: string[] = []
  let length = 0
  let cut = 0

  /** `repeated`: the shown ancestor's name and value, which text inside it would only repeat. */
  const visit = (node: AXNode, depth: number, repeated: readonly string[]): void => {
    const role = text(node.role)
    if (HIDDEN_ROLES.has(role)) return
    const name = text(node.name)
    const interactive = INTERACTIVE_ROLES.has(role)
    let show = false
    if (!node.ignored) {
      if (interactiveOnly) show = interactive
      else if (role === 'StaticText') show = name !== '' && !repeated.includes(name)
      else show = interactive || STRUCTURE_ROLES.has(role) || name !== ''
    }
    if (show) {
      const line = `${interactiveOnly ? '' : '  '.repeat(depth)}- ${describe(node, role)}`
      if (length + line.length > maxChars) cut++
      else {
        lines.push(line)
        length += line.length + 1
      }
    }
    const childDepth = show ? depth + 1 : depth
    if (childDepth > maxDepth) return
    // Text inside a shown element that is its name (a button's label) or value (a field's text).
    const forChildren = show ? [name, text(node.value)].filter(Boolean) : repeated
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId)
      if (child) visit(child, childDepth, forChildren)
    }
  }
  visit(root, 0, [])

  if (lines.length === 0) {
    return interactiveOnly ? 'No buttons, links or fields here.' : 'Nothing readable here.'
  }
  if (cut > 0) {
    lines.push(
      `… ${cut} more element${cut === 1 ? '' : 's'} cut. Read part of the page with ref, or ` +
        'pass interactive: true.'
    )
  }
  return lines.join('\n')
}

/** Lines of formatAXTree's output that mention `query` (case-insensitive), at most `limit`. */
export function findInTree(tree: string, query: string, limit = 30): string {
  const needle = query.toLowerCase()
  const matches = tree
    .split('\n')
    .filter((line) => line.includes('[ref=') && line.toLowerCase().includes(needle))
    .map((line) => line.trimStart())
  if (matches.length === 0) return `Nothing on the page matches "${query}".`
  const shown = matches.slice(0, limit)
  if (matches.length > limit) shown.push(`… and ${matches.length - limit} more`)
  return shown.join('\n')
}
