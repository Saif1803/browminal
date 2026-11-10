/** Schemes that open another app (after the user confirms). */
const EXTERNAL_SCHEMES = new Set(['mailto:', 'tel:'])

// Schemes Chromium handles itself inside a page (about:blank, srcdoc, data: frames, blob: URLs).
const IN_PAGE_SCHEMES = new Set(['http:', 'https:', 'about:', 'data:', 'blob:'])

export type NavigationDecision = 'allow' | 'external' | 'block'

/**
 * What to do when a page (not main) navigates a frame, is redirected, or opens a window.
 * Pages never reach browminal:// (an error page there could spoof the address bar), file: or
 * other apps' schemes; mailto: and tel: may open their app once the user agrees.
 */
export function decideNavigation(url: string): NavigationDecision {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return 'block'
  }
  if (IN_PAGE_SCHEMES.has(protocol)) return 'allow'
  if (EXTERNAL_SCHEMES.has(protocol)) return 'external'
  return 'block'
}
