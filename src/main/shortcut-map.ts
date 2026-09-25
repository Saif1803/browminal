type SimpleCommand =
  | 'newTab'
  | 'closeTab'
  | 'reopenTab'
  | 'nextTab'
  | 'previousTab'
  | 'selectLastTab'
  | 'focusAddressBar'
  | 'reload'
  | 'hardReload'
  | 'stop'
  | 'back'
  | 'forward'
  | 'home'
  | 'find'
  | 'findNext'
  | 'findPrevious'
  | 'print'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'toggleFullscreen'
  | 'toggleDevTools'

export type Command = { type: SimpleCommand } | { type: 'selectTab'; index: number }

/** The parts of Electron's `Input` the map reads. */
export interface KeyInput {
  key: string
  code: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

type Platform = 'mac' | 'other'

/**
 * Shortcuts as "<modifiers>+<key>". Mod is Cmd on macOS and Ctrl elsewhere; Ctrl is only
 * written on macOS, Meta only elsewhere. Modifiers are always in the order Mod, Ctrl, Alt, Shift, Meta.
 */
const COMMON: Record<string, SimpleCommand> = {
  'Mod+t': 'newTab',
  'Mod+w': 'closeTab',
  'Mod+Shift+t': 'reopenTab',
  'Mod+9': 'selectLastTab',
  'Mod+l': 'focusAddressBar',
  'Mod+r': 'reload',
  'Mod+Shift+r': 'hardReload',
  Escape: 'stop',
  'Mod+f': 'find',
  'Mod+g': 'findNext',
  'Mod+Shift+g': 'findPrevious',
  'Mod+p': 'print',
  'Mod+=': 'zoomIn',
  'Mod++': 'zoomIn',
  'Mod+Shift+=': 'zoomIn',
  'Mod+Shift++': 'zoomIn',
  'Mod+-': 'zoomOut',
  'Mod+0': 'zoomReset'
}

const BY_PLATFORM: Record<Platform, Record<string, SimpleCommand>> = {
  mac: {
    'Ctrl+Tab': 'nextTab',
    'Ctrl+Shift+Tab': 'previousTab',
    'Mod+Alt+ArrowRight': 'nextTab',
    'Mod+Alt+ArrowLeft': 'previousTab',
    'Mod+Shift+]': 'nextTab',
    'Mod+Shift+[': 'previousTab',
    'Mod+[': 'back',
    'Mod+]': 'forward',
    'Mod+ArrowLeft': 'back',
    'Mod+ArrowRight': 'forward',
    'Mod+Shift+h': 'home',
    'Mod+Ctrl+f': 'toggleFullscreen',
    'Mod+Alt+i': 'toggleDevTools'
  },
  other: {
    'Mod+Tab': 'nextTab',
    'Mod+Shift+Tab': 'previousTab',
    'Mod+PageDown': 'nextTab',
    'Mod+PageUp': 'previousTab',
    'Mod+F4': 'closeTab',
    F5: 'reload',
    'Mod+F5': 'hardReload',
    'Shift+F5': 'hardReload',
    F3: 'findNext',
    'Shift+F3': 'findPrevious',
    'Alt+ArrowLeft': 'back',
    'Alt+ArrowRight': 'forward',
    'Alt+Home': 'home',
    F11: 'toggleFullscreen',
    F12: 'toggleDevTools',
    'Mod+Shift+i': 'toggleDevTools'
  }
}

/** Held-down keys repeat these; everything else fires once per press. */
const REPEATABLE = new Set<Command['type']>([
  'nextTab',
  'previousTab',
  'back',
  'forward',
  'findNext',
  'findPrevious',
  'zoomIn',
  'zoomOut'
])

export function isRepeatable(command: Command): boolean {
  return REPEATABLE.has(command.type)
}

/**
 * The key as the map names it. Letters and digits come from the physical key when the
 * layout doesn't produce a Latin letter or digit (Cyrillic, AZERTY), like other browsers.
 */
function normalizeKey({ key, code }: KeyInput): string {
  if (/^[a-z]$/i.test(key)) return key.toLowerCase()
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1].toLowerCase()
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code)
  if (digit) return digit[1]
  if (code === 'BracketLeft') return '['
  if (code === 'BracketRight') return ']'
  return key
}

function chordFor(input: KeyInput, platform: Platform): string {
  const mac = platform === 'mac'
  const modifiers = [
    (mac ? input.meta : input.control) && 'Mod',
    mac && input.control && 'Ctrl',
    input.alt && 'Alt',
    input.shift && 'Shift',
    !mac && input.meta && 'Meta'
  ].filter(Boolean)
  return [...modifiers, normalizeKey(input)].join('+')
}

/** The browser command for a key press, or null to let the page (or UI) have it. */
export function commandForInput(input: KeyInput, platform: Platform): Command | null {
  const chord = chordFor(input, platform)
  const tabNumber = /^Mod\+([1-8])$/.exec(chord)
  if (tabNumber) return { type: 'selectTab', index: Number(tabNumber[1]) - 1 }
  const type = BY_PLATFORM[platform][chord] ?? COMMON[chord]
  return type ? { type } : null
}
