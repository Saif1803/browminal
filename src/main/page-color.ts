/**
 * A page's background colour as `getComputedStyle` reports it (`rgb(…)` / `rgba(…)`), as a hex
 * colour, or null for anything else (transparent, other colour spaces, junk from the page).
 * A translucent colour is shown over white, like Chromium's default page background.
 */
export function parsePageColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^rgba?\((\d{1,3}), (\d{1,3}), (\d{1,3})(?:, (0|1|0?\.\d+))?\)$/.exec(value)
  if (!match) return null
  const [r, g, b] = match.slice(1, 4).map(Number)
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  if ([r, g, b].some((channel) => channel > 255) || alpha === 0) return null
  const hex = (channel: number): string =>
    Math.round(channel * alpha + 255 * (1 - alpha))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** The veil's page: an empty, script-free document whose body fades between clear and a colour. */
export const VEIL_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    '<style>html,body{margin:0;height:100%;background:transparent}' +
    'body{opacity:0;transition-property:opacity;transition-timing-function:ease}</style>'
)}`

/**
 * CSS that fades the veil to `opacity` in `color` over `durationMs`. `color` must be a hex colour.
 * Important, because inserted sheets come before the page's own in the cascade.
 */
export function veilCss(color: string, opacity: 0 | 1, durationMs: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Not a hex colour: ${color}`)
  const duration = Math.max(0, Math.round(durationMs))
  return `body{background:${color}!important;opacity:${opacity}!important;transition-duration:${duration}ms!important}`
}
