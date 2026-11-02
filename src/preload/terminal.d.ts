import type { TerminalViewApi } from '../shared/terminal-view'

declare global {
  interface Window {
    /** Only in the terminal view (src/preload/terminal.ts). */
    terminal: TerminalViewApi
  }
}
