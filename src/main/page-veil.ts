import { WebContentsView, type Rectangle, type View } from 'electron'
import { VEIL_PAGE, veilCss } from './page-color'

// How long after fading out the veil leaves the window (a little longer than the fade itself).
const DETACH_DELAY_MS = 60

/**
 * A see-through view laid over the page while a new document loads. It fades in over the old page
 * in that page's colour, hides the blank frames of the new one, and fades out once it has drawn.
 * (A plain View can't do this: web pages draw above it whatever the order.)
 *
 * Its page is an empty data: document with no script (CSP `default-src 'none'`); main styles it
 * with insertCSS. It's attached only while visible, since it takes the clicks of whatever is below.
 */
export class PageVeil {
  private readonly view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false
    }
  })
  private attached = false
  private color = '#000000'
  private detachTimer: NodeJS.Timeout | null = null
  // insertCSS is async: styles are applied in order, each replacing the one before.
  private styling: Promise<string | null> = Promise.resolve(null)

  /** `refocus` is called when a click lands on the veil, to give focus back to the page. */
  constructor(
    private readonly parent: View,
    refocus: () => void
  ) {
    this.view.setBackgroundColor('#00000000')
    const wc = this.view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('will-navigate', (event) => event.preventDefault())
    wc.on('focus', refocus)
    wc.loadURL(VEIL_PAGE).catch(() => {})
  }

  /** Lays the veil over `bounds` (on top of every other view) and fades it in. */
  cover(bounds: Rectangle, radius: number, color: string, fadeMs: number): void {
    this.cancelDetach()
    this.setBounds(bounds, radius)
    // Adding it again also brings it back to the top, above a tab attached since.
    this.parent.addChildView(this.view)
    this.attached = true
    this.color = color
    this.style(veilCss(color, 1, fadeMs))
  }

  /** Fades the veil out, then takes it out of the window. */
  uncover(fadeMs: number): void {
    if (!this.attached) return
    // A newer, shorter fade replaces one still running.
    this.cancelDetach()
    this.style(veilCss(this.color, 0, fadeMs))
    this.detachTimer = setTimeout(() => {
      this.detachTimer = null
      this.attached = false
      this.parent.removeChildView(this.view)
    }, fadeMs + DETACH_DELAY_MS)
  }

  setBounds(bounds: Rectangle, radius: number): void {
    this.view.setBounds(bounds)
    this.view.setBorderRadius(radius)
  }

  destroy(): void {
    this.cancelDetach()
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  private cancelDetach(): void {
    if (this.detachTimer) clearTimeout(this.detachTimer)
    this.detachTimer = null
  }

  private style(css: string): void {
    const wc = this.view.webContents
    this.styling = this.styling.then(async (previous) => {
      if (wc.isDestroyed()) return null
      const key = await wc.insertCSS(css).catch(() => null)
      if (key === null) return previous
      if (previous) await wc.removeInsertedCSS(previous).catch(() => {})
      return key
    })
  }
}
