import { describe, expect, test } from 'bun:test'
import {
  formatBoxModel,
  formatComputed,
  formatMatchedStyles,
  type SheetInfo
} from './element-inspect'

const quad = (x: number, y: number, w: number, h: number): number[] => [
  x,
  y,
  x + w,
  y,
  x + w,
  y + h,
  x,
  y + h
]

test('formatBoxModel: size, place and each edge', () => {
  // A 100×40 border box at (10, 20): 1px border, 8/16 padding, 12px bottom margin.
  expect(
    formatBoxModel({
      margin: quad(10, 20, 100, 52),
      border: quad(10, 20, 100, 40),
      padding: quad(11, 21, 98, 38),
      content: quad(27, 29, 66, 22),
      width: 100,
      height: 40
    })
  ).toBe('box: 100×40 at (10, 20) · padding 8 16 · border 1 · margin 0 0 12 0')
})

test('formatComputed: the names asked for, in order', () => {
  const computed = [
    { name: 'display', value: 'flex' },
    { name: 'color', value: 'rgb(0, 0, 0)' }
  ]
  expect(formatComputed(computed, ['color', 'display', 'colour'])).toBe(
    '  color: rgb(0, 0, 0)\n  display: flex\n  colour: (not a computed property)'
  )
})

test('formatComputed: shorthands put together from their longhands', () => {
  const longhands: Record<string, string> = {
    'margin-top': '0px',
    'margin-right': '8px',
    'margin-bottom': '0px',
    'margin-left': '8px',
    'overflow-x': 'hidden',
    'overflow-y': 'hidden',
    'row-gap': '4px',
    'column-gap': '8px',
    'flex-grow': '1',
    'flex-shrink': '1',
    'flex-basis': '0%'
  }
  for (const side of ['top', 'right', 'bottom', 'left']) {
    longhands[`border-${side}-width`] = side === 'bottom' ? '2px' : '1px'
    longhands[`border-${side}-style`] = 'solid'
    longhands[`border-${side}-color`] = 'red'
  }
  const computed = Object.entries(longhands).map(([name, value]) => ({ name, value }))
  expect(formatComputed(computed, ['margin', 'overflow', 'gap', 'flex', 'border', 'padding'])).toBe(
    [
      '  margin: 0px 8px',
      '  overflow: hidden',
      '  gap: 4px 8px',
      '  flex: 1 1 0%',
      '  border: top 1px solid red, right 1px solid red, bottom 2px solid red, left 1px solid red',
      '  padding: (not a computed property)'
    ].join('\n')
  )
})

describe('formatMatchedStyles', () => {
  const sheets = new Map<string, SheetInfo>([
    [
      's1',
      {
        sourceURL: 'http://localhost:5173/src/App.css',
        startLine: 0,
        isInline: false,
        isConstructed: false
      }
    ],
    ['s2', { sourceURL: '', startLine: 40, isInline: true, isConstructed: false }],
    ['s3', { sourceURL: '', startLine: 0, isInline: false, isConstructed: true }]
  ])
  const prop = (
    name: string,
    value: string,
    extra: object = {}
  ): { name: string; value: string; text: string } => ({
    name,
    value,
    text: `${name}: ${value};`,
    ...extra
  })

  test('most specific first, with locations and overridden declarations', () => {
    const text = formatMatchedStyles(
      {
        matchedCSSRules: [
          {
            rule: {
              origin: 'user-agent',
              selectorList: { text: 'button' },
              style: { cssProperties: [prop('padding', '1px 6px')] }
            }
          },
          {
            rule: {
              styleSheetId: 's1',
              origin: 'regular',
              selectorList: { text: '.btn' },
              style: {
                range: { startLine: 11 },
                cssProperties: [
                  prop('color', 'blue'),
                  prop('padding', '8px'),
                  // A longhand Chromium expanded: not written in the source.
                  { name: 'padding-top', value: '8px' }
                ]
              }
            }
          },
          {
            rule: {
              styleSheetId: 's2',
              origin: 'regular',
              selectorList: { text: '.btn.primary' },
              media: [{ text: '(max-width: 600px)' }],
              style: {
                range: { startLine: 2 },
                cssProperties: [prop('padding', '4px'), prop('colr', 'red', { parsedOk: false })]
              }
            }
          }
        ],
        inlineStyle: { cssProperties: [prop('color', 'red')] }
      },
      sheets,
      'http://localhost:5173/'
    )
    expect(text).toBe(
      [
        'element.style {  /* style attribute */',
        '  color: red;',
        '}',
        '@media (max-width: 600px)',
        '.btn.primary {  /* http://localhost:5173/ (inline <style>):43 */',
        '  padding: 4px;',
        '  colr: red; /* invalid: ignored */',
        '}',
        '.btn {  /* http://localhost:5173/src/App.css:12 */',
        '  color: blue; /* overridden */',
        '  padding: 8px; /* overridden */',
        '}',
        '(1 browser default or Nebula rule not shown)'
      ].join('\n')
    )
  })

  test('!important beats later declarations', () => {
    const text = formatMatchedStyles(
      {
        matchedCSSRules: [
          {
            rule: {
              styleSheetId: 's3',
              origin: 'regular',
              selectorList: { text: 'a' },
              style: { cssProperties: [prop('color', 'green !important', { important: true })] }
            }
          }
        ],
        inlineStyle: { cssProperties: [prop('color', 'red')] }
      },
      sheets,
      'http://x/'
    )
    expect(text).toBe(
      [
        'element.style {  /* style attribute */',
        '  color: red; /* overridden */',
        '}',
        'a {  /* constructed stylesheet (adoptedStyleSheets) */',
        '  color: green !important;',
        '}'
      ].join('\n')
    )
  })

  test('says when nothing matches', () => {
    expect(formatMatchedStyles({}, sheets, 'http://x/')).toBe('(no author CSS rules match)')
  })
})
