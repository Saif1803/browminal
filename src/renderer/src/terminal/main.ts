import '@fontsource-variable/fira-code/wght.css'
import '@xterm/xterm/css/xterm.css'
import '../assets/main.css'
import './terminal.css'

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'

/** One session's xterm. Output for every session is written as it comes, shown or not. */
interface SessionView {
  term: Terminal
  fit: FitAddon
  element: HTMLDivElement
}

const api = window.terminal
const isMac = api.platform === 'darwin'
const container = document.getElementById('terminals')!
const views = new Map<number, SessionView>()
let activeId: number | null = null

// Fira Code, bundled. No ligatures: xterm's ligature addon reads font files from disk, which a
// sandboxed view can't.
const FONT_FAMILY =
  "'Fira Code Variable', 'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace"
const FONT_SIZE = 13

// ANSI colours readable on the console colour; light backgrounds need darker ones.
const DARK_ANSI = {
  black: '#3a3936',
  red: '#e5776b',
  green: '#8fbf7f',
  yellow: '#e0b86a',
  blue: '#7aa6e0',
  magenta: '#c69be0',
  cyan: '#6fc2c2',
  white: '#d6d4cc',
  brightBlack: '#75736c',
  brightRed: '#f09488',
  brightGreen: '#a9d69a',
  brightYellow: '#eccb8a',
  brightBlue: '#98bdf0',
  brightMagenta: '#d8b4f0',
  brightCyan: '#8fd8d8',
  brightWhite: '#faf9f5'
}
const LIGHT_ANSI = {
  black: '#141413',
  red: '#b3372b',
  green: '#3d7a2e',
  yellow: '#8a6100',
  blue: '#2f5fa8',
  magenta: '#8a3fa8',
  cyan: '#1f7a7a',
  white: '#8f8d85',
  brightBlack: '#5e5d59',
  brightRed: '#c94c3f',
  brightGreen: '#4f8f3f',
  brightYellow: '#9e7000',
  brightBlue: '#3d72c2',
  brightMagenta: '#9e52bf',
  brightCyan: '#2a8f8f',
  brightWhite: '#141413'
}
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)')

/** The xterm colours from the theme tokens, light or dark like the rest of Browminal. */
function theme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string): string => css.getPropertyValue(name).trim()
  const accent = token('--color-accent')
  return {
    background: token('--color-console'),
    foreground: token('--color-ink'),
    cursor: accent,
    cursorAccent: token('--color-console'),
    selectionBackground: `color-mix(in srgb, ${accent} 35%, transparent)`,
    ...(darkScheme.matches ? DARK_ANSI : LIGHT_ANSI)
  }
}

darkScheme.addEventListener('change', () => {
  for (const { term } of views.values()) term.options.theme = theme()
})

/**
 * Copy and paste like other terminals: Ctrl+C copies when text is selected (otherwise it's the
 * shell's Ctrl+C), Ctrl+Shift+C always copies; Ctrl+V and Ctrl+Shift+V paste (Cmd on macOS).
 */
function handleKey(term: Terminal, event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') return true
  const mod = isMac ? event.metaKey : event.ctrlKey
  const key = event.key.toLowerCase()
  if (mod && key === 'c' && (isMac || event.shiftKey || term.hasSelection())) {
    if (term.hasSelection()) {
      api.copy(term.getSelection())
      if (!isMac) term.clearSelection()
    }
    event.preventDefault()
    return false
  }
  // Left to the browser, whose paste event xterm turns into input.
  if (mod && key === 'v') return false
  return true
}

function fitAndReport(id: number, view: SessionView): void {
  if (!view.element.classList.contains('active')) return
  view.fit.fit()
  api.resize(id, view.term.cols, view.term.rows)
}

function createView(id: number): SessionView {
  const element = document.createElement('div')
  element.className = 'session'
  container.append(element)
  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    macOptionIsMeta: true,
    theme: theme()
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // http(s) links open in a Browminal tab (main checks the URL again).
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault()
      api.openLink(id, uri)
    })
  )
  term.open(element)
  term.attachCustomKeyEventHandler((event) => handleKey(term, event))
  term.onData((data) => api.input(id, data))
  const view = { term, fit, element }
  views.set(id, view)
  return view
}

function show(id: number | null): void {
  activeId = id
  for (const [viewId, view] of views) view.element.classList.toggle('active', viewId === id)
  const view = id === null ? undefined : views.get(id)
  if (!view || id === null) return
  fitAndReport(id, view)
  view.term.focus()
}

api.onSessions((sessions, nextActive) => {
  const ids = new Set(sessions.map((session) => session.id))
  for (const [id, view] of views) {
    if (ids.has(id)) continue
    view.term.dispose()
    view.element.remove()
    views.delete(id)
  }
  for (const { id } of sessions) if (!views.has(id)) createView(id)
  show(nextActive)
})

api.onOutput((id, data) => views.get(id)?.term.write(data))

api.onFocus(() => {
  if (activeId !== null) views.get(activeId)?.term.focus()
})

// The panel was resized (dragged, window resized): the shown session re-fits.
new ResizeObserver(() => {
  const view = activeId === null ? undefined : views.get(activeId)
  if (view && activeId !== null) fitAndReport(activeId, view)
}).observe(container)

// xterm measures its cell size once, when a session's view opens: load the font before main sends
// any sessions, or the cells are sized for the fallback font.
void document.fonts
  .load(`${FONT_SIZE}px 'Fira Code Variable'`)
  .catch(() => undefined)
  .then(() => api.ready())
