import { describe, expect, test } from 'bun:test'
import {
  formatPick,
  formatPickLine,
  PickList,
  pickPrompt,
  type ElementPick,
  type NewPick
} from './picks'

const element: NewPick = {
  kind: 'element',
  tabId: 3,
  url: 'http://localhost:5173/cart',
  title: 'Shop',
  time: Date.UTC(2026, 10, 2, 12, 0, 0),
  ref: 41,
  description: 'button "Checkout"',
  selector: '#cart > button:nth-of-type(2)',
  html: '<button class="cta">Checkout</button>',
  box: 'box: 120×40 at (10, 20) · padding 8 16 · border 0 · margin 0',
  styles: '  display: inline-block',
  source: 'src/Cart.tsx:42:9 (React, in <Cart>)',
  image: 'abc'
}

const errors: NewPick = {
  kind: 'errors',
  tabId: 3,
  url: 'http://localhost:5173/cart',
  title: 'Shop',
  time: Date.UTC(2026, 10, 2, 12, 0, 0),
  count: 2,
  errors: '#4 12:00:00.000 [error] Uncaught TypeError: x is undefined'
}

describe('PickList', () => {
  test('numbers picks and keeps the newest', () => {
    const list = new PickList(2)
    expect(list.latest).toBeUndefined()
    expect(list.lastId).toBe(0)
    list.add(element)
    list.add(errors)
    const third = list.add(element)
    expect(third.id).toBe(3)
    expect(list.all.map((pick) => pick.id)).toEqual([2, 3])
    expect(list.get(1)).toBeUndefined()
    expect(list.get(2)?.kind).toBe('errors')
    expect(list.latest).toBe(third)
    expect(list.lastId).toBe(3)
  })
})

describe('formatting', () => {
  const list = new PickList()
  const picked = list.add(element) as ElementPick
  const sent = list.add(errors)

  test('the prompt typed into the agent', () => {
    expect(pickPrompt(picked)).toBe('Look at the element I picked in Browminal (pick 1): ')
    expect(pickPrompt(sent)).toBe('Look at the errors I sent from Browminal (pick 2): ')
  })

  test('one line per pick', () => {
    expect(formatPickLine(picked)).toBe(
      'pick 1: element button "Checkout" [ref=41] on [tab 3] Shop — http://localhost:5173/cart'
    )
    expect(formatPickLine(sent)).toBe(
      'pick 2: 2 errors on [tab 3] Shop — http://localhost:5173/cart'
    )
  })

  test('a pick in full', () => {
    const text = formatPick(picked)
    expect(text).toStartWith('# Pick 1, 2026-11-02T12:00:00.000Z\n[tab 3] Shop')
    expect(text).toContain('The user picked button "Checkout" [ref=41]')
    expect(text).toContain('source: src/Cart.tsx:42:9 (React, in <Cart>)')
    expect(text).toContain('selector: #cart > button:nth-of-type(2)')
    expect(formatPick({ ...picked, source: null, box: null })).toContain('box: not rendered')
    expect(formatPick(sent)).toContain("The user sent the page's 2 newest errors:\n#4 ")
  })
})
