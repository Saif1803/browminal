import { describe, expect, test } from 'bun:test'
import { commandForInput, isRepeatable, type KeyInput } from './shortcut-map'

const press = (key: string, mods: Partial<KeyInput> = {}, code = ''): KeyInput => ({
  key,
  code,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods
})
const ctrl = { control: true }
const cmd = { meta: true }
const win = (input: KeyInput): string | undefined => commandForInput(input, 'other')?.type
const mac = (input: KeyInput): string | undefined => commandForInput(input, 'mac')?.type

describe('commandForInput', () => {
  test('tab shortcuts use Ctrl on Windows/Linux and Cmd on macOS', () => {
    expect(win(press('t', ctrl))).toBe('newTab')
    expect(mac(press('t', cmd))).toBe('newTab')
    expect(win(press('t', cmd))).toBeUndefined()
    expect(mac(press('t', ctrl))).toBeUndefined()
    expect(win(press('T', { ...ctrl, shift: true }))).toBe('reopenTab')
    expect(win(press('w', ctrl))).toBe('closeTab')
    expect(win(press('F4', ctrl))).toBe('closeTab')
  })

  test('Ctrl+Tab cycles tabs on every platform', () => {
    expect(win(press('Tab', ctrl))).toBe('nextTab')
    expect(win(press('Tab', { ...ctrl, shift: true }))).toBe('previousTab')
    expect(mac(press('Tab', ctrl))).toBe('nextTab')
    expect(mac(press('}', { ...cmd, shift: true }, 'BracketRight'))).toBe('nextTab')
  })

  test('number keys select tabs; 9 is the last tab', () => {
    expect(commandForInput(press('1', ctrl, 'Digit1'), 'other')).toEqual({
      type: 'selectTab',
      index: 0
    })
    expect(commandForInput(press('8', cmd, 'Digit8'), 'mac')).toEqual({
      type: 'selectTab',
      index: 7
    })
    expect(win(press('9', ctrl, 'Digit9'))).toBe('selectLastTab')
    // AZERTY: the 1 key types "&" without Shift.
    expect(commandForInput(press('&', ctrl, 'Digit1'), 'other')).toEqual({
      type: 'selectTab',
      index: 0
    })
  })

  test('letters fall back to the physical key on non-Latin layouts', () => {
    expect(win(press('е', ctrl, 'KeyT'))).toBe('newTab')
    // macOS Option changes the character: Cmd+Option+I types "ˆ".
    expect(mac(press('ˆ', { ...cmd, alt: true }, 'KeyI'))).toBe('toggleDevTools')
  })

  test('reload, stop and navigation', () => {
    expect(win(press('F5'))).toBe('reload')
    expect(win(press('F5', ctrl))).toBe('hardReload')
    expect(win(press('F5', { shift: true }))).toBe('hardReload')
    expect(mac(press('r', { ...cmd, shift: true }))).toBe('hardReload')
    expect(win(press('Escape'))).toBe('stop')
    expect(win(press('ArrowLeft', { alt: true }))).toBe('back')
    expect(win(press('ArrowRight', { alt: true }))).toBe('forward')
    expect(mac(press('[', cmd, 'BracketLeft'))).toBe('back')
    expect(win(press('Home', { alt: true }))).toBe('home')
    expect(mac(press('h', { ...cmd, shift: true }))).toBe('home')
  })

  test('zoom accepts = and + with or without Shift', () => {
    expect(win(press('=', ctrl))).toBe('zoomIn')
    expect(win(press('+', { ...ctrl, shift: true }))).toBe('zoomIn')
    expect(win(press('+', ctrl, 'NumpadAdd'))).toBe('zoomIn')
    expect(win(press('-', ctrl))).toBe('zoomOut')
    expect(win(press('0', ctrl, 'Digit0'))).toBe('zoomReset')
  })

  test('find, print, fullscreen and DevTools', () => {
    expect(win(press('f', ctrl))).toBe('find')
    expect(win(press('F3'))).toBe('findNext')
    expect(win(press('F3', { shift: true }))).toBe('findPrevious')
    expect(mac(press('g', { ...cmd, shift: true }))).toBe('findPrevious')
    expect(win(press('p', ctrl))).toBe('print')
    expect(win(press('F11'))).toBe('toggleFullscreen')
    expect(mac(press('f', { ...cmd, control: true }))).toBe('toggleFullscreen')
    expect(win(press('F12'))).toBe('toggleDevTools')
    expect(win(press('I', { ...ctrl, shift: true }))).toBe('toggleDevTools')
  })

  test('bookmarks', () => {
    expect(win(press('d', ctrl))).toBe('bookmark')
    expect(mac(press('d', cmd))).toBe('bookmark')
    expect(win(press('B', { ...ctrl, shift: true }))).toBe('toggleBookmarksBar')
    expect(mac(press('b', { ...cmd, shift: true }))).toBe('toggleBookmarksBar')
    expect(win(press('b', ctrl))).toBeUndefined()
  })

  test('extra modifiers mean no match', () => {
    expect(win(press('t', { ...ctrl, alt: true }))).toBeUndefined() // AltGr+T
    expect(win(press('r', { ...ctrl, meta: true }))).toBeUndefined()
    expect(win(press('F5', { alt: true }))).toBeUndefined()
    expect(win(press('a'))).toBeUndefined()
    expect(win(press('c', ctrl))).toBeUndefined()
  })
})

describe('isRepeatable', () => {
  test('only harmless commands repeat while a key is held', () => {
    expect(isRepeatable({ type: 'nextTab' })).toBe(true)
    expect(isRepeatable({ type: 'zoomIn' })).toBe(true)
    expect(isRepeatable({ type: 'closeTab' })).toBe(false)
    expect(isRepeatable({ type: 'newTab' })).toBe(false)
    expect(isRepeatable({ type: 'toggleFullscreen' })).toBe(false)
  })
})
