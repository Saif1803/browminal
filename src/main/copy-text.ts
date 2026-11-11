import { clipboard } from 'electron'

/**
 * Puts text on the clipboard. Since Electron 44 the clipboard is asynchronous; a copy the OS
 * refuses (another app holding the clipboard) is logged rather than left unhandled.
 */
export function copyText(text: string): void {
  clipboard.writeText(text).catch((error: unknown) => console.error('Copy failed:', error))
}
