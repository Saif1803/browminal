import type { WebContents } from 'electron'

// Mixed into every thumb colour so a dark or pale accent still shows on the page behind it.
const NEUTRAL = '#8a8a8a'

/**
 * The page's accent (its <meta name="theme-color">, as Chromium reports it) if it's a plain hex
 * colour, else null. It ends up inside CSS we insert, so nothing else gets through.
 */
export function parseAccent(color: string | null): string | null {
  return color && /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color.toLowerCase() : null
}

/**
 * A thin, quiet scrollbar tinted with the page's accent: a clear track and a faint rounded thumb
 * that firms up and widens a little on hover. User-origin CSS, so a page's own scrollbar styles win.
 */
export function scrollbarCss(accent: string | null): string {
  const tint = accent ? `color-mix(in srgb, ${accent} 60%, ${NEUTRAL})` : NEUTRAL
  return `
::-webkit-scrollbar { width: 8px; height: 8px; background: transparent; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-button { display: none; }
::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, ${tint} 40%, transparent);
  background-clip: padding-box;
  border: 2px solid transparent;
  border-radius: 8px;
}
::-webkit-scrollbar-thumb:hover, ::-webkit-scrollbar-thumb:active {
  background-color: color-mix(in srgb, ${tint} 70%, transparent);
  border-width: 1px;
}
`
}

/** Keeps a tab's page scrollbars styled: on every document, and again when its accent changes. */
export function styleScrollbars(webContents: WebContents): void {
  let accent: string | null = null
  let key: string | null = null
  let version = 0

  const apply = async (): Promise<void> => {
    const mine = ++version
    const previous = key
    key = null
    if (previous) await webContents.removeInsertedCSS(previous).catch(() => {})
    if (webContents.isDestroyed()) return
    const inserted = await webContents
      .insertCSS(scrollbarCss(accent), { cssOrigin: 'user' })
      .catch(() => null)
    // A newer apply started meanwhile: it owns the page's sheet, so drop this one.
    if (mine === version) key = inserted
    else if (inserted && !webContents.isDestroyed())
      webContents.removeInsertedCSS(inserted).catch(() => {})
  }

  webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    // A new document starts without our sheet or an accent.
    accent = null
    key = null
  })
  webContents.on('dom-ready', () => void apply())
  webContents.on('did-change-theme-color', (_event, color) => {
    const next = parseAccent(color)
    if (next === accent) return
    accent = next
    void apply()
  })
}
