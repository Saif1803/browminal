import type { OverlayApi } from '../shared/overlay'

declare global {
  interface Window {
    /** Only in the overlay view (src/preload/overlay.ts). */
    overlay: OverlayApi
  }
}
