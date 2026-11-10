import { commandForInput, type KeyInput } from './shortcut-map'

/** Params for one CDP Input.dispatchKeyEvent. */
export interface KeyEvent {
  type: 'keyDown' | 'rawKeyDown' | 'keyUp'
  key: string
  code: string
  windowsVirtualKeyCode: number
  nativeVirtualKeyCode: number
  modifiers: number
  text?: string
  unmodifiedText?: string
}

type Modifier = 'Alt' | 'Control' | 'Meta' | 'Shift'

// CDP's modifier bits.
const BITS: Record<Modifier, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }
const MODIFIER_KEYS: Record<Modifier, { code: string; keyCode: number }> = {
  Alt: { code: 'AltLeft', keyCode: 18 },
  Control: { code: 'ControlLeft', keyCode: 17 },
  Meta: { code: 'MetaLeft', keyCode: 91 },
  Shift: { code: 'ShiftLeft', keyCode: 16 }
}
const MODIFIER_NAMES: Record<string, Modifier | 'Mod'> = {
  alt: 'Alt',
  option: 'Alt',
  ctrl: 'Control',
  control: 'Control',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  shift: 'Shift',
  mod: 'Mod'
}

interface KeyDefinition {
  key: string
  code: string
  keyCode: number
  /** What it types, if anything. */
  text?: string
}

const NAMED: Record<string, KeyDefinition> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45 }
}

function definition(name: string): KeyDefinition | null {
  const named = NAMED[name.toLowerCase()]
  if (named) return named
  const fn = /^f([1-9]|1[0-2])$/i.exec(name)
  if (fn) return { key: `F${fn[1]}`, code: `F${fn[1]}`, keyCode: 111 + Number(fn[1]) }
  if (/^[a-z]$/i.test(name)) {
    const lower = name.toLowerCase()
    return {
      key: lower,
      code: `Key${lower.toUpperCase()}`,
      keyCode: lower.charCodeAt(0) - 32,
      text: lower
    }
  }
  if (/^[0-9]$/.test(name)) {
    return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), text: name }
  }
  // Other single characters (punctuation) type themselves.
  if ([...name].length === 1) return { key: name, code: '', keyCode: 0, text: name }
  return null
}

/** A parsed combination like "Control+Shift+K": its modifiers and its key. */
export interface KeyCombo {
  modifiers: Modifier[]
  key: KeyDefinition
}

/**
 * Reads "Enter", "Control+a", "Shift+Tab", "Mod+z" (Mod: Cmd on macOS, Ctrl elsewhere).
 * Throws with a message for the agent when it can't.
 */
export function parseKeyCombo(spec: string, platform: string): KeyCombo {
  // "+" alone, or as the last key ("Control++"), is the plus key.
  const parts = spec === '+' ? ['+'] : spec.replace(/\+\+$/, '+plus').split('+')
  const last = parts.pop()!
  const keyName = last === 'plus' && parts.length > 0 ? '+' : last
  const modifiers: Modifier[] = []
  for (const part of parts) {
    const name = MODIFIER_NAMES[part.trim().toLowerCase()]
    if (!name) throw new Error(`Unknown modifier "${part}" in "${spec}"`)
    const modifier = name === 'Mod' ? (platform === 'darwin' ? 'Meta' : 'Control') : name
    if (!modifiers.includes(modifier)) modifiers.push(modifier)
  }
  const key = definition(keyName.trim() === '' ? keyName : keyName.trim())
  if (!key) throw new Error(`Unknown key "${keyName}" in "${spec}"`)
  return { modifiers, key }
}

/**
 * The key events for one press of a combination: modifiers down, the key down and up,
 * modifiers up. The key types its text only without Ctrl/Alt/Meta (Ctrl+A selects, it doesn't
 * type "a"); Shift makes letters capitals.
 */
export function keyEvents({ modifiers, key }: KeyCombo): KeyEvent[] {
  const events: KeyEvent[] = []
  let bits = 0
  for (const modifier of modifiers) {
    bits |= BITS[modifier]
    const { code, keyCode } = MODIFIER_KEYS[modifier]
    events.push(event('rawKeyDown', modifier, code, keyCode, bits))
  }
  const typesText =
    key.text !== undefined && !modifiers.some((m) => m === 'Control' || m === 'Alt' || m === 'Meta')
  const shifted = modifiers.includes('Shift') && /^[a-z]$/.test(key.key)
  const keyName = shifted ? key.key.toUpperCase() : key.key
  const text = typesText ? (shifted ? key.text!.toUpperCase() : key.text) : undefined
  const down = event(text ? 'keyDown' : 'rawKeyDown', keyName, key.code, key.keyCode, bits)
  if (text) {
    down.text = text
    down.unmodifiedText = key.text
  }
  events.push(down, event('keyUp', keyName, key.code, key.keyCode, bits))
  for (const modifier of [...modifiers].reverse()) {
    bits &= ~BITS[modifier]
    const { code, keyCode } = MODIFIER_KEYS[modifier]
    events.push(event('keyUp', modifier, code, keyCode, bits))
  }
  return events
}

function event(
  type: KeyEvent['type'],
  key: string,
  code: string,
  keyCode: number,
  modifiers: number
): KeyEvent {
  return {
    type,
    key,
    code,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers
  }
}

/**
 * The Browminal command a combination would run (CDP keys reach the browser's shortcuts, so an
 * agent pressing Ctrl+W would close the tab), or null. Escape is the page's.
 */
export function browserCommandFor({ modifiers, key }: KeyCombo, platform: string): string | null {
  const input: KeyInput = {
    key: key.key,
    code: key.code,
    control: modifiers.includes('Control'),
    meta: modifiers.includes('Meta'),
    alt: modifiers.includes('Alt'),
    shift: modifiers.includes('Shift')
  }
  const command = commandForInput(input, platform === 'darwin' ? 'mac' : 'other')
  return command && command.type !== 'stop' ? command.type : null
}
