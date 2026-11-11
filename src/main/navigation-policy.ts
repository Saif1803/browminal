/** Schemes that open another app (after the user confirms). */
const EXTERNAL_SCHEMES = new Set(['mailto:', 'tel:'])

// Schemes Chromium handles itself inside a page (about:blank, srcdoc, data: frames, blob: URLs).
const IN_PAGE_SCHEMES = new Set(['http:', 'https:', 'about:', 'data:', 'blob:'])

// Chromium's built-in PDF viewer (an extension Electron ships). Since Electron 41 a PDF shows in
// frames of the tab's own page rather than in a guest of its own, so its frames pass here too.
// (URL.origin is "null" for chrome-extension:, so the scheme and host are compared.)
const PDF_VIEWER_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai'

export type NavigationDecision = 'allow' | 'external' | 'block'

/**
 * What to do when a page (not main) navigates a frame, is redirected, or opens a window.
 * Pages never reach browminal:// (an error page there could spoof the address bar), file: or
 * other apps' schemes; mailto: and tel: may open their app once the user agrees. The PDF viewer
 * may load in a frame (never as a page; Chromium checks what pages may load from it).
 */
export function decideNavigation(
  url: string,
  { mainFrame = true }: { mainFrame?: boolean } = {}
): NavigationDecision {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'block'
  }
  const { protocol } = parsed
  if (IN_PAGE_SCHEMES.has(protocol)) return 'allow'
  if (!mainFrame && protocol === 'chrome-extension:' && parsed.host === PDF_VIEWER_ID) {
    return 'allow'
  }
  if (EXTERNAL_SCHEMES.has(protocol)) return 'external'
  return 'block'
}
