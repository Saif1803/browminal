import { describe, expect, test } from 'bun:test'
import { findInTree, formatAXTree, joinFrameTrees, type AXNode } from './ax-tree'

let nextId = 0
/** A node with children; ids are made up, refs are backend ids. */
function node(
  role: string,
  name = '',
  extra: Partial<AXNode> & { children?: AXNode[] } = {}
): AXNode[] {
  const { children = [], ...rest } = extra
  const id = String(++nextId)
  const kids = children
  const self: AXNode = {
    nodeId: id,
    ignored: false,
    role: { type: 'role', value: role },
    name: name ? { type: 'computedString', value: name } : undefined,
    backendDOMNodeId: Number(id) + 100,
    childIds: [],
    ...rest
  }
  return [self, ...kids]
}

/** Builds a flat CDP-style list from nested node() calls, wiring childIds. */
function tree(build: () => AXNode[][]): AXNode[] {
  const groups = build()
  return groups.flat()
}

function page(): AXNode[] {
  nextId = 0
  const label = node('StaticText', 'Checkout')
  const inline = node('InlineTextBox', 'Checkout')
  label[0].childIds = [inline[0].nodeId]
  const button = node('button', 'Checkout')
  button[0].childIds = [label[0].nodeId]
  const field = node('textbox', 'Email', {
    value: { type: 'string', value: 'a@b.c' },
    properties: [
      { name: 'focused', value: { type: 'boolean', value: true } },
      { name: 'required', value: { type: 'boolean', value: true } }
    ]
  })
  const heading = node('heading', 'Your cart', {
    properties: [{ name: 'level', value: { type: 'integer', value: 1 } }]
  })
  const para = node('StaticText', 'Total: $49.75')
  const wrapper = node('generic', '')
  wrapper[0].childIds = [para[0].nodeId, button[0].nodeId]
  const hidden = node('button', 'Hidden', { ignored: true })
  const root = node('RootWebArea', 'Cart test')
  root[0].childIds = [heading[0].nodeId, wrapper[0].nodeId, field[0].nodeId, hidden[0].nodeId]
  return tree(() => [root, heading, wrapper, para, button, label, inline, field, hidden])
}

describe('formatAXTree', () => {
  test('one line per element, indented, with refs; wrappers and repeated text left out', () => {
    expect(formatAXTree(page())).toBe(
      [
        '- page "Cart test" [ref=109]',
        '  - heading "Your cart" [level=1] [ref=105]',
        '  - text "Total: $49.75" [ref=106]',
        '  - button "Checkout" [ref=103]',
        '  - textbox "Email": "a@b.c" [focused, required] [ref=104]'
      ].join('\n')
    )
  })

  test('interactive only: a flat list of controls', () => {
    expect(formatAXTree(page(), { interactiveOnly: true })).toBe(
      [
        '- button "Checkout" [ref=103]',
        '- textbox "Email": "a@b.c" [focused, required] [ref=104]'
      ].join('\n')
    )
  })

  test('from a ref, and to a depth', () => {
    const nodes = page()
    expect(formatAXTree(nodes, { rootRef: 103 })).toBe('- button "Checkout" [ref=103]')
    expect(formatAXTree(nodes, { maxDepth: 0 })).toBe('- page "Cart test" [ref=109]')
    expect(formatAXTree(nodes, { rootRef: 999 })).toContain('No element with ref=999')
  })

  test('cuts long output and says how much is missing', () => {
    const text = formatAXTree(page(), { maxChars: 60 })
    expect(text.split('\n')[0]).toBe('- page "Cart test" [ref=109]')
    expect(text).toMatch(/… \d+ more elements? cut/)
  })

  test('states read from properties', () => {
    nextId = 0
    const box = node('checkbox', 'Remember me', {
      properties: [
        { name: 'checked', value: { type: 'tristate', value: 'mixed' } },
        { name: 'disabled', value: { type: 'boolean', value: true } },
        { name: 'expanded', value: { type: 'boolean', value: false } },
        { name: 'invalid', value: { type: 'token', value: 'false' } }
      ]
    })
    expect(formatAXTree(box)).toBe(
      '- checkbox "Remember me" [disabled, checked=mixed, collapsed] [ref=101]'
    )
  })

  test('text that repeats a field’s value is left out', () => {
    nextId = 0
    const inner = node('StaticText', 'a@b.c')
    const field = node('textbox', 'Email', { value: { type: 'string', value: 'a@b.c' } })
    field[0].childIds = [inner[0].nodeId]
    expect(formatAXTree([...field, ...inner])).toBe('- textbox "Email": "a@b.c" [ref=102]')
  })

  test('says when there is nothing', () => {
    expect(formatAXTree([])).toBe('The page has no content yet.')
    nextId = 0
    expect(formatAXTree(node('generic'), { interactiveOnly: true })).toBe(
      'No buttons, links or fields here.'
    )
  })
})

test('findInTree returns matching lines with refs', () => {
  const text = formatAXTree(page())
  expect(findInTree(text, 'checkout')).toBe('- button "Checkout" [ref=103]')
  expect(findInTree(text, 'nope')).toBe('Nothing on the page matches "nope".')
  expect(findInTree(text, 'e', 1)).toMatch(/^- page "Cart test" \[ref=109\]\n… and \d+ more$/)
})

describe('joinFrameTrees', () => {
  const ax = (
    nodeId: string,
    role: string,
    name: string,
    ref: number,
    childIds: string[] = []
  ): AXNode => ({
    nodeId,
    ignored: false,
    role: { type: 'role', value: role },
    name: name ? { type: 'computedString', value: name } : undefined,
    backendDOMNodeId: ref,
    childIds
  })
  // The page: a heading and two iframes (refs 3 and 4). Each tree numbers its nodes from 1.
  const main = [
    ax('1', 'RootWebArea', 'Shop', 1, ['2', '3', '4']),
    ax('2', 'heading', 'Cart', 2),
    ax('3', 'Iframe', 'Preview', 3),
    ax('4', 'Iframe', '', 4)
  ]
  const preview = [
    ax('1', 'RootWebArea', 'Button story', 20, ['2', '3']),
    ax('2', 'button', 'Buy', 21),
    ax('3', 'Iframe', '', 22)
  ]
  const nested = [ax('1', 'RootWebArea', 'Inner', 30, ['2']), ax('2', 'link', 'Help', 31)]

  test('each frame’s tree goes under its iframe, nested ones too, in any order', () => {
    const joined = joinFrameTrees(main, [
      { owner: 22, url: 'http://localhost:6006/inner.html', nodes: nested },
      { owner: 3, url: 'http://localhost:6006/iframe.html', nodes: preview }
    ])
    expect(formatAXTree(joined)).toBe(
      [
        '- page "Shop" [ref=1]',
        '  - heading "Cart" [ref=2]',
        '  - frame "Preview" [ref=3]',
        '    - page "Button story" [ref=20]',
        '      - button "Buy" [ref=21]',
        '      - frame [ref=22]',
        '        - page "Inner" [ref=30]',
        '          - link "Help" [ref=31]',
        '  - frame [ref=4]'
      ].join('\n')
    )
    expect(formatAXTree(joined, { interactiveOnly: true })).toBe(
      ['- button "Buy" [ref=21]', '- link "Help" [ref=31]'].join('\n')
    )
    expect(formatAXTree(joined, { rootRef: 20 })).toContain('- button "Buy" [ref=21]')
    // The page's own trees are untouched.
    expect(main[2].childIds).toEqual([])
  })

  test('a frame that can’t be read says so; one without its iframe is left out', () => {
    const joined = joinFrameTrees(main, [
      { owner: 4, url: 'https://js.stripe.com/v3/', nodes: null },
      { owner: 99, url: 'http://localhost/lost', nodes: nested },
      { owner: null, url: 'http://localhost/unknown', nodes: nested }
    ])
    const text = formatAXTree(joined)
    expect(text).toContain(
      '  - frame [ref=4]\n    - frame content not readable (https://js.stripe.com/v3/): an embed from another site'
    )
    expect(text).not.toContain('Inner')
  })

  test('a frame already in the tree isn’t added twice', () => {
    const withChild = [
      ax('1', 'RootWebArea', 'Shop', 1, ['2']),
      ax('2', 'Iframe', '', 3, ['3']),
      ax('3', 'RootWebArea', 'Inner', 30)
    ]
    const joined = joinFrameTrees(withChild, [{ owner: 3, url: 'http://x/', nodes: nested }])
    expect(formatAXTree(joined).match(/Inner/g)).toHaveLength(1)
  })
})
