/**
 * inspect's reply: an element's box, its computed styles and the CSS rules that match it, with
 * the stylesheet and line each rule is on. Pure: the CDP results come in as plain objects.
 */

/** The computed styles shown when the agent names none: the ones layout bugs are made of. */
export const DEFAULT_COMPUTED = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'max-width',
  'margin',
  'padding',
  'border',
  'overflow',
  'flex',
  'flex-direction',
  'align-items',
  'justify-content',
  'gap',
  'grid-template-columns',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'opacity',
  'visibility',
  'transform',
  'pointer-events'
]

/** DOM.BoxModel: quads are [x1, y1, x2, y2, x3, y3, x4, y4], clockwise from the top left. */
export interface BoxModel {
  content: number[]
  padding: number[]
  border: number[]
  margin: number[]
  width: number
  height: number
}

/** Where a stylesheet came from (CSS.styleSheetAdded's header). */
export interface SheetInfo {
  sourceURL: string
  /** Its first line in the file it's in (an inline <style> starts partway down the page). */
  startLine: number
  isInline: boolean
  isConstructed: boolean
  /** Vite in dev: the CSS file an injected <style> holds (its data-vite-dev-id). */
  file?: string
}

/** Where a rule starts in its stylesheet's own text, 1-based: what its source map is read at. */
export interface RulePlace {
  styleSheetId: string
  line: number
  column: number
}

/** The original file and line of a rule ("src/Cart.module.css:12:1"), or null when unknown. */
export type RuleLookup = (place: RulePlace) => string | null

interface CssProperty {
  name: string
  value: string
  important?: boolean
  implicit?: boolean
  text?: string
  parsedOk?: boolean
  disabled?: boolean
  range?: unknown
}

interface CssStyle {
  styleSheetId?: string
  cssProperties?: CssProperty[]
  range?: { startLine: number; startColumn?: number }
}

interface CssRule {
  styleSheetId?: string
  selectorList?: { text?: string }
  origin?: string
  style?: CssStyle
  media?: { text?: string }[]
}

export interface MatchedStyles {
  inlineStyle?: CssStyle
  matchedCSSRules?: { rule: CssRule }[]
}

const round = (n: number): number => Math.round(n * 100) / 100

const sides = (outer: number[], inner: number[]): number[] => [
  inner[1] - outer[1],
  outer[2] - inner[2],
  outer[5] - inner[5],
  inner[0] - outer[0]
]

/** Top, right, bottom, left as CSS writes them: "8", "8 16", "0 0 12 0". */
function sidesText(values: (number | string)[]): string {
  const [t, r, b, l] = values.map((v) => (typeof v === 'number' ? String(round(v)) : v))
  if (t === r && r === b && b === l) return t
  if (t === b && r === l) return `${t} ${r}`
  return `${t} ${r} ${b} ${l}`
}

const SIDES = ['top', 'right', 'bottom', 'left']

/** Computed styles hold longhands only: a shorthand's value, put together from them. */
function shorthandValue(name: string, values: ReadonlyMap<string, string>): string | undefined {
  const all = (names: string[]): string[] | undefined => {
    const found = names.map((n) => values.get(n))
    return found.every((v) => v !== undefined) ? (found as string[]) : undefined
  }
  const pair = (a: string, b: string): string | undefined => {
    const found = all([a, b])
    return found && (found[0] === found[1] ? found[0] : found.join(' '))
  }
  switch (name) {
    case 'margin':
    case 'padding': {
      const found = all(SIDES.map((side) => `${name}-${side}`))
      return found && sidesText(found)
    }
    case 'border': {
      const sides = SIDES.map((side) =>
        all(['width', 'style', 'color'].map((part) => `border-${side}-${part}`))?.join(' ')
      )
      if (sides.some((side) => side === undefined)) return undefined
      if (sides.every((side) => side === sides[0])) return sides[0]
      return SIDES.map((side, i) => `${side} ${sides[i]}`).join(', ')
    }
    case 'overflow':
      return pair('overflow-x', 'overflow-y')
    case 'gap':
      return pair('row-gap', 'column-gap')
    case 'flex':
      return all(['flex-grow', 'flex-shrink', 'flex-basis'])?.join(' ')
    default:
      return undefined
  }
}

/** "box: 320×48 at (12, 140) · padding 8 16 · border 1 · margin 0 0 12" (CSS px, border box). */
export function formatBoxModel(model: BoxModel): string {
  const [x, y] = model.border
  const parts = [`box: ${round(model.width)}×${round(model.height)} at (${round(x)}, ${round(y)})`]
  parts.push(`padding ${sidesText(sides(model.padding, model.content))}`)
  parts.push(`border ${sidesText(sides(model.border, model.padding))}`)
  parts.push(`margin ${sidesText(sides(model.margin, model.border))}`)
  return parts.join(' · ')
}

/** The computed styles asked for (or the defaults), one "name: value" per line. */
export function formatComputed(
  computed: { name: string; value: string }[],
  properties: readonly string[] = DEFAULT_COMPUTED
): string {
  const values = new Map(computed.map(({ name, value }) => [name, value]))
  return properties
    .map((name) => {
      const value = values.get(name) ?? shorthandValue(name, values)
      return `  ${name}: ${value ?? '(not a computed property)'}`
    })
    .join('\n')
}

// Declarations written in the source; Chromium also lists the longhands a shorthand expands to.
const declared = (property: CssProperty): boolean =>
  !property.disabled && (property.text !== undefined || property.range !== undefined)

const placeOf = (rule: CssRule): RulePlace | null =>
  rule.styleSheetId && rule.style?.range
    ? {
        styleSheetId: rule.styleSheetId,
        line: rule.style.range.startLine + 1,
        column: (rule.style.range.startColumn ?? 0) + 1
      }
    : null

/** Where each author rule starts, to look up in the stylesheets' source maps first. */
export function rulePlaces(matched: MatchedStyles): RulePlace[] {
  return (matched.matchedCSSRules ?? [])
    .filter(({ rule }) => !rule.origin || rule.origin === 'regular')
    .map(({ rule }) => placeOf(rule))
    .filter((place) => place !== null)
}

function location(
  rule: CssRule,
  sheets: ReadonlyMap<string, SheetInfo>,
  documentUrl: string,
  lookup: RuleLookup
): string {
  const sheet = rule.styleSheetId ? sheets.get(rule.styleSheetId) : undefined
  if (!sheet) return 'unknown stylesheet'
  const place = placeOf(rule)
  const original = place && lookup(place)
  if (original) return original
  if (sheet.isConstructed) return 'constructed stylesheet (adoptedStyleSheets)'
  if (sheet.file) {
    const line = place ? ` (line ${place.line} of the CSS Vite serves for it)` : ''
    return `${sheet.file}${line}`
  }
  const url = sheet.sourceURL || documentUrl
  const where = sheet.isInline && !sheet.sourceURL ? `${url} (inline <style>)` : url
  if (!place) return where
  return `${where}:${sheet.startLine + place.line}`
}

/**
 * The rules that match an element, most specific first like DevTools' Styles pane, each with
 * where it's written (`lookup` gives the original file from a source map). A declaration a later
 * one beats is marked overridden (by name only: shorthand vs longhand isn't worked out, so the
 * computed styles have the last word). Browser defaults and Browminal's own styles are left out,
 * and counted.
 */
export function formatMatchedStyles(
  matched: MatchedStyles,
  sheets: ReadonlyMap<string, SheetInfo>,
  documentUrl: string,
  lookup: RuleLookup = () => null
): string {
  interface Block {
    head: string
    where: string
    media: string[]
    properties: CssProperty[]
  }
  // In increasing precedence, as Chromium lists them; the inline style beats every rule.
  const blocks: Block[] = []
  let hidden = 0
  for (const { rule } of matched.matchedCSSRules ?? []) {
    if (rule.origin && rule.origin !== 'regular') {
      hidden++
      continue
    }
    blocks.push({
      head: rule.selectorList?.text ?? '(rule)',
      where: location(rule, sheets, documentUrl, lookup),
      media: (rule.media ?? []).map((m) => m.text ?? '').filter(Boolean),
      properties: (rule.style?.cssProperties ?? []).filter(declared)
    })
  }
  const inline = (matched.inlineStyle?.cssProperties ?? []).filter(declared)
  if (inline.length) {
    blocks.push({ head: 'element.style', where: 'style attribute', media: [], properties: inline })
  }

  // The winner per property: the last !important one, else the last one.
  const winners = new Map<string, CssProperty>()
  for (const block of blocks) {
    for (const property of block.properties) {
      if (property.parsedOk === false) continue
      const current = winners.get(property.name)
      if (!current || property.important || !current.important) winners.set(property.name, property)
    }
  }

  const text = blocks
    .reverse()
    .map((block) => {
      const media = block.media.map((m) => `@media ${m}\n`).join('')
      const lines = block.properties.map((property) => {
        const important = property.important ? ' !important' : ''
        const note =
          property.parsedOk === false
            ? ' /* invalid: ignored */'
            : winners.get(property.name) !== property
              ? ' /* overridden */'
              : ''
        return `  ${property.name}: ${property.value.replace(/\s*!important$/, '')}${important};${note}`
      })
      return `${media}${block.head} {  /* ${block.where} */\n${lines.join('\n')}\n}`
    })
    .join('\n')
  const more = hidden
    ? `\n(${hidden} browser default or Browminal rule${hidden === 1 ? '' : 's'} not shown)`
    : ''
  return (text || '(no author CSS rules match)') + more
}
