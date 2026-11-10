import { describe, expect, test } from 'bun:test'
import { browserCommandFor, keyEvents, parseKeyCombo } from './cdp-keys'

const win = (spec: string): ReturnType<typeof parseKeyCombo> => parseKeyCombo(spec, 'win32')

describe('parseKeyCombo', () => {
  test('named keys, letters, digits, punctuation and F-keys', () => {
    expect(win('Enter').key).toMatchObject({ key: 'Enter', keyCode: 13, text: '\r' })
    expect(win('esc').key.key).toBe('Escape')
    expect(win('a').key).toMatchObject({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a' })
    expect(win('7').key).toMatchObject({ code: 'Digit7', keyCode: 55 })
    expect(win('/').key).toMatchObject({ key: '/', text: '/' })
    expect(win('F5').key).toMatchObject({ key: 'F5', keyCode: 116 })
    expect(win('+').key.key).toBe('+')
  })

  test('modifiers, with Mod meaning Cmd on macOS and Ctrl elsewhere', () => {
    expect(win('Ctrl+Shift+k').modifiers).toEqual(['Control', 'Shift'])
    expect(win('Mod+z').modifiers).toEqual(['Control'])
    expect(parseKeyCombo('Mod+z', 'darwin').modifiers).toEqual(['Meta'])
    expect(win('Control++').key.key).toBe('+')
  })

  test('refuses what it does not know', () => {
    expect(() => win('Hyper+a')).toThrow('Unknown modifier "Hyper"')
    expect(() => win('Banana')).toThrow('Unknown key "Banana"')
  })
})

describe('keyEvents', () => {
  test('a typing key sends keyDown with its text, then keyUp', () => {
    expect(keyEvents(win('Enter'))).toEqual([
      {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        modifiers: 0,
        text: '\r',
        unmodifiedText: '\r'
      },
      {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        modifiers: 0
      }
    ])
  })

  test('modifiers wrap the key; Ctrl+A types nothing', () => {
    const events = keyEvents(win('Control+a'))
    expect(events.map((e) => [e.type, e.key, e.modifiers])).toEqual([
      ['rawKeyDown', 'Control', 2],
      ['rawKeyDown', 'a', 2],
      ['keyUp', 'a', 2],
      ['keyUp', 'Control', 0]
    ])
    expect(events.some((e) => e.text)).toBe(false)
  })

  test('Shift makes capitals', () => {
    const down = keyEvents(win('Shift+a')).find((e) => e.type === 'keyDown')!
    expect(down).toMatchObject({ key: 'A', text: 'A', modifiers: 8 })
  })
})

test('browserCommandFor names Browminal shortcuts, but leaves Escape to the page', () => {
  expect(browserCommandFor(win('Control+w'), 'win32')).toBe('closeTab')
  expect(browserCommandFor(win('F5'), 'win32')).toBe('reload')
  expect(browserCommandFor(parseKeyCombo('Meta+w', 'darwin'), 'darwin')).toBe('closeTab')
  expect(browserCommandFor(win('Escape'), 'win32')).toBe(null)
  expect(browserCommandFor(win('Control+a'), 'win32')).toBe(null)
  expect(browserCommandFor(win('Enter'), 'win32')).toBe(null)
})
