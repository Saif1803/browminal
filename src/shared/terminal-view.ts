/*
 * The terminal view's contract (its preload, main). Kept apart from types.ts on purpose: the
 * two preloads must not import the same module, or the bundler moves it into a shared chunk,
 * which a sandboxed preload can't require.
 */

/** What the terminal view (its own renderer, xterm) can do: window.terminal. */
export interface TerminalViewApi {
  platform: string
  /** Keys typed (or text pasted) in session `id`. */
  input(id: number, data: string): void
  /** The session's xterm was fitted to cols × rows. */
  resize(id: number, cols: number, rows: number): void
  /** Copies selected terminal text to the clipboard. */
  copy(text: string): void
  /** A link clicked in session `id`'s output (http(s) only; opens in a tab). */
  openLink(id: number, url: string): void
  /** Listeners are set: main sends the sessions, then each one's output so far. */
  ready(): void
  /** Which sessions exist and which one is shown. */
  onSessions(
    callback: (sessions: { id: number; exited: boolean }[], activeId: number | null) => void
  ): () => void
  onOutput(callback: (id: number, data: string) => void): () => void
  /** Put the keyboard in the shown session. */
  onFocus(callback: () => void): () => void
}

/** IPC between the terminal view and main; only the terminal view may use these. */
export const TerminalViewChannel = {
  Input: 'terminal-view:input',
  Resize: 'terminal-view:resize',
  Copy: 'terminal-view:copy',
  OpenLink: 'terminal-view:open-link',
  Ready: 'terminal-view:ready',
  Sessions: 'terminal-view:sessions',
  Output: 'terminal-view:output',
  Focus: 'terminal-view:focus'
} as const
