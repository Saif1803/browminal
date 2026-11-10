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
  'Iframe',
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

/** Our own role: a frame whose content couldn't be read; its name is the frame's URL. */
export const UNREAD_FRAME_ROLE = 'browminal:unread-frame'

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
  if (role === UNREAD_FRAME_ROLE) {
    return `frame content not readable${name ? ` (${name})` : ''}: an embed from another site`
  }
  const label =
    role === 'RootWebArea'
      ? 'page'
      : role === 'StaticText'
        ? 'text'
        : role === 'Iframe'
          ? 'frame'
          : role
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

/** One frame's accessibility tree, to join under the `<iframe>` element that holds it. */
export interface FrameTree {
  /** The backend DOM node id of its `<iframe>` (DOM.getFrameOwner), or null if unknown. */
  owner: number | null
  url: string
  /** Its tree (Accessibility.getFullAXTree with its frameId), or null when it can't be read. */
  nodes: readonly AXNode[] | null
}

/**
 * The page's tree with each frame's tree under its `<iframe>` (nested frames too, in any order),
 * so read_page and find see what iframes show. Node ids get a per-frame prefix (each tree counts
 * its own); refs are backend DOM node ids, unique in the tab's renderer, so they work across
 * frames. A frame that couldn't be read shows as one line saying so; one whose `<iframe>` isn't
 * in the tree is left out.
 */
export function joinFrameTrees(main: readonly AXNode[], frames: readonly FrameTree[]): AXNode[] {
  const copy = (node: AXNode, prefix: string): AXNode => ({
    ...node,
    nodeId: prefix + node.nodeId,
    childIds: (node.childIds ?? []).map((id) => prefix + id)
  })
  const joined = main.map((node) => copy(node, ''))
  const trees = frames.map((frame, index) =>
    frame.nodes ? frame.nodes.map((node) => copy(node, `frame${index}:`)) : null
  )
  const byRef = new Map<number, AXNode>()
  for (const node of [...joined, ...trees.flatMap((tree) => tree ?? [])]) {
    if (node.backendDOMNodeId !== undefined && !byRef.has(node.backendDOMNodeId)) {
      byRef.set(node.backendDOMNodeId, node)
    }
  }
  const inMain = new Set(main.map((node) => node.backendDOMNodeId))
  frames.forEach((frame, index) => {
    const owner = frame.owner === null ? undefined : byRef.get(frame.owner)
    if (!owner) return
    const tree = trees[index]
    // Already in the tree it's joined to (Chromium put it there itself): not twice.
    const rootRef = tree?.[0]?.backendDOMNodeId
    if (rootRef !== undefined && inMain.has(rootRef)) return
    const root: AXNode =
      tree && tree.length > 0
        ? tree[0]
        : {
            nodeId: `frame${index}:unread`,
            ignored: false,
            role: { type: 'role', value: UNREAD_FRAME_ROLE },
            name: { type: 'string', value: frame.url }
          }
    owner.childIds = [...(owner.childIds ?? []), root.nodeId]
    joined.push(...(tree && tree.length > 0 ? tree : [root]))
  })
  return joined
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
