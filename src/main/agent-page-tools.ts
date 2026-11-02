import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DEFAULT_AX_MAX_CHARS, findInTree, formatAXTree, type AXNode } from './ax-tree'
import {
  AGENT_WORLD_ID,
  assertInspectable,
  describeLoad,
  tabIdInput,
  text,
  waitForLoad,
  type AgentContext
} from './agent-tool-helpers'
import { browserCommandFor, keyEvents, parseKeyCombo } from './cdp-keys'
import type { CdpSession } from './cdp'
import type { Tab } from './tabs'

// After an action, how long to watch for a navigation it started, and how long to wait for it.
const SETTLE_MS = 150
const NAVIGATION_TIMEOUT_MS = 15_000
const DEFAULT_WAIT_MS = 10_000
const MAX_WAIT_MS = 60_000
const POLL_MS = 250
const DEFAULT_SCROLL_PX = 600
const MAX_TYPE_LENGTH = 10_000

const refInput = z.number().int().positive().describe('The element’s ref, from read_page or find')
const pointInput = {
  x: z.number().optional().describe('Instead of ref: x in CSS px from the page’s left edge'),
  y: z.number().optional().describe('Instead of ref: y in CSS px from the page’s top edge')
}

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const
const modifiersInput = z
  .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
  .optional()
  .describe('Keys held during the click')

const staleRef = (ref: number): Error =>
  new Error(`No element with ref=${ref} on the page now (it changed?). Call read_page again.`)

/** A short description of an element for replies: tag and visible text. */
const DESCRIBE_ELEMENT = `function () {
  if (this.nodeType === Node.TEXT_NODE) return 'text "' + this.data.trim().slice(0, 60) + '"'
  const labelled = this.labels && this.labels[0] ? this.labels[0].innerText : ''
  const choice = this.type === 'checkbox' || this.type === 'radio'
  const label = (this.getAttribute('aria-label') || labelled || this.innerText ||
    (choice ? '' : this.value) || this.getAttribute('placeholder') || this.getAttribute('title') ||
    '').trim().replace(/\\s+/g, ' ')
  return this.localName + (label ? ' "' + label.slice(0, 60) + '"' : '')
}`

interface RemoteObject {
  objectId?: string
  value?: unknown
}

/** Runs `fn` on the element `ref` in the page and returns its JSON result. */
async function callOn<T>(
  cdp: CdpSession,
  ref: number,
  fn: string,
  args: unknown[] = []
): Promise<T> {
  let objectId: string | undefined
  try {
    const { object } = await cdp.send<{ object: RemoteObject }>('DOM.resolveNode', {
      backendNodeId: ref
    })
    objectId = object.objectId
  } catch (error) {
    if (cdp.dialog) throw error
  }
  if (!objectId) throw staleRef(ref)
  const { result, exceptionDetails } = await cdp.send<{
    result: RemoteObject
    exceptionDetails?: { exception?: { description?: string }; text: string }
  }>('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: fn,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  })
  cdp.send('Runtime.releaseObject', { objectId }).catch(() => {})
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  }
  return result.value as T
}

/** Scrolls element `ref` into view and returns its centre in CSS px. */
async function centerOf(cdp: CdpSession, ref: number): Promise<{ x: number; y: number }> {
  let quads: number[][] = []
  try {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref })
    ;({ quads } = await cdp.send<{ quads: number[][] }>('DOM.getContentQuads', {
      backendNodeId: ref
    }))
  } catch (error) {
    if (cdp.dialog) throw error
    throw staleRef(ref)
  }
  const area = (q: number[]): number =>
    Math.abs(
      (q[0] * q[3] -
        q[1] * q[2] +
        q[2] * q[5] -
        q[3] * q[4] +
        q[4] * q[7] -
        q[5] * q[6] +
        q[6] * q[1] -
        q[7] * q[0]) /
        2
    )
  const quad = quads.find((q) => area(q) > 1)
  if (!quad) throw new Error(`The element ref=${ref} has no size on screen (hidden?)`)
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4
  }
}

/** Where to act: element `ref`'s centre, or the point given. */
async function target(
  cdp: CdpSession,
  ref: number | undefined,
  x: number | undefined,
  y: number | undefined
): Promise<{ x: number; y: number; what: string }> {
  if (ref !== undefined) {
    const point = await centerOf(cdp, ref)
    const what = await callOn<string>(cdp, ref, DESCRIBE_ELEMENT).catch(() => 'element')
    return { ...point, what: `${what} [ref=${ref}]` }
  }
  if (x === undefined || y === undefined) throw new Error('Give ref, or both x and y')
  return { x, y, what: `(${Math.round(x)}, ${Math.round(y)})` }
}

async function pressCombo(cdp: CdpSession, spec: string, times: number): Promise<void> {
  const combo = parseKeyCombo(spec, process.platform)
  const command = browserCommandFor(combo, process.platform)
  if (command) {
    throw new Error(
      `${spec} is a Nebula shortcut (${command}), not a key for the page. Use the tools instead ` +
        '(navigate, new_tab…).'
    )
  }
  for (let i = 0; i < times; i++) {
    for (const event of keyEvents(combo)) await cdp.send('Input.dispatchKeyEvent', { ...event })
  }
}

/**
 * Runs an action that may navigate or open a dialog, then reports what happened: a dialog that
 * opened (the action is then stuck behind it, which is fine), or a new page it led to.
 */
async function act(
  cdp: CdpSession,
  tab: Tab,
  done: string,
  action: () => Promise<void>
): Promise<string> {
  const before = tab.webContents.getURL()
  try {
    await action()
  } catch (error) {
    const dialog = cdp.dialog
    if (!dialog) throw error
    return `${done}. It opened ${dialog.type}(${JSON.stringify(dialog.message)}): answer it with handle_dialog.`
  }
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  if (cdp.dialog) {
    const { type, message } = cdp.dialog
    return `${done}. It opened ${type}(${JSON.stringify(message)}): answer it with handle_dialog.`
  }
  if (tab.webContents.isLoading()) await waitForLoad(tab.webContents, NAVIGATION_TIMEOUT_MS)
  if (tab.webContents.isDestroyed()) return `${done}. The tab closed.`
  return tab.webContents.getURL() !== before ? `${done}. Now on: ${describeLoad(tab)}` : `${done}.`
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The page's visible text, read in an isolated world (the page's scripts can't change it). */
async function pageText(tab: Tab): Promise<string> {
  const value: unknown = await tab.webContents.executeJavaScriptInIsolatedWorld(AGENT_WORLD_ID, [
    { code: 'document.body ? document.body.innerText : ""' }
  ])
  return typeof value === 'string' ? value : ''
}

/** Tools that read a page's structure and act in it like a user: refs, clicks, keys, forms. */
export function registerPageTools(mcp: McpServer, context: AgentContext): void {
  /** The tab and its debugger session, for a tool that reads or acts in the page. */
  const page = (tabId: number | undefined): { tab: Tab; cdp: CdpSession } => {
    const tab = context.tab(tabId)
    assertInspectable(tab)
    return { tab, cdp: context.cdp(tab) }
  }

  mcp.registerTool(
    'read_page',
    {
      description:
        'The page as an accessibility tree: one element per line (role, name, value, state), ' +
        'each with a ref to pass to click, type, fill… Refs stay valid until the page changes. ' +
        'interactive: true lists only buttons, links and fields.',
      inputSchema: {
        tabId: tabIdInput,
        interactive: z.boolean().optional().describe('Only controls, as a flat list'),
        ref: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Read only this element and inside it'),
        depth: z.number().int().min(0).max(100).optional().describe('Levels to include'),
        maxChars: z.number().int().min(500).max(200_000).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ tabId, interactive, ref, depth, maxChars }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const { nodes } = await cdp.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree')
        const tree = formatAXTree(nodes, {
          interactiveOnly: interactive,
          rootRef: ref,
          maxDepth: depth,
          maxChars: maxChars ?? DEFAULT_AX_MAX_CHARS
        })
        return text(`${describeLoad(tab)}\n\n${tree}`)
      })
    }
  )

  mcp.registerTool(
    'find',
    {
      description:
        'Finds elements whose role, name or value contains some text; returns their refs.',
      inputSchema: { tabId: tabIdInput, text: z.string().min(1).max(500) },
      annotations: { readOnlyHint: true }
    },
    async ({ tabId, text: query }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const { nodes } = await cdp.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree')
        return text(findInTree(formatAXTree(nodes, { maxChars: Infinity }), query))
      })
    }
  )

  mcp.registerTool(
    'click',
    {
      description:
        'Clicks an element (by ref; scrolled into view first) or a point, with real mouse events. ' +
        'Waits for a page it opens to load, and says if it opened a dialog.',
      inputSchema: {
        tabId: tabIdInput,
        ref: refInput.optional(),
        ...pointInput,
        button: z.enum(['left', 'right', 'middle']).optional(),
        doubleClick: z.boolean().optional(),
        modifiers: modifiersInput
      }
    },
    async ({ tabId, ref, x, y, button = 'left', doubleClick, modifiers = [] }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const point = await target(cdp, ref, x, y)
        const bits = modifiers.reduce((sum, m) => sum | MODIFIER_BITS[m], 0)
        const mouse = { x: point.x, y: point.y, modifiers: bits }
        const reply = await act(cdp, tab, `Clicked ${point.what}`, async () => {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...mouse })
          for (let count = 1; count <= (doubleClick ? 2 : 1); count++) {
            const press = { ...mouse, button, clickCount: count }
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...press })
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...press })
          }
        })
        return text(reply)
      })
    }
  )

  mcp.registerTool(
    'hover',
    {
      description:
        'Moves the mouse over an element (by ref) or a point: shows hover menus, tooltips.',
      inputSchema: { tabId: tabIdInput, ref: refInput.optional(), ...pointInput }
    },
    async ({ tabId, ref, x, y }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const point = await target(cdp, ref, x, y)
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
        return text(`Hovering over ${point.what}.`)
      })
    }
  )

  mcp.registerTool(
    'type',
    {
      description:
        'Types text where the keyboard is, or into an element (by ref) after focusing it. Adds to ' +
        'what is there; use fill to replace a field’s value. submit: true presses Enter after.',
      inputSchema: {
        tabId: tabIdInput,
        text: z.string().max(MAX_TYPE_LENGTH),
        ref: refInput.optional(),
        submit: z.boolean().optional()
      }
    },
    async ({ tabId, text: typed, ref, submit }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        if (ref !== undefined) {
          try {
            await cdp.send('DOM.focus', { backendNodeId: ref })
          } catch (error) {
            if (cdp.dialog) throw error
            throw staleRef(ref)
          }
        }
        const where = ref === undefined ? '' : ` into ref=${ref}`
        const reply = await act(cdp, tab, `Typed ${typed.length} characters${where}`, async () => {
          if (typed) await cdp.send('Input.insertText', { text: typed })
          if (submit) await pressCombo(cdp, 'Enter', 1)
        })
        return text(reply)
      })
    }
  )

  mcp.registerTool(
    'fill',
    {
      description:
        'Replaces the value of a text field, textarea or editable element (by ref), as if the user ' +
        'selected all and typed. Fires the page’s input events.',
      inputSchema: { tabId: tabIdInput, ref: refInput, value: z.string().max(MAX_TYPE_LENGTH) }
    },
    async ({ tabId, ref, value }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        await callOn(
          cdp,
          ref,
          `function () {
            this.focus()
            if (typeof this.select === 'function') this.select()
            else {
              const range = document.createRange()
              range.selectNodeContents(this)
              const selection = getSelection()
              selection.removeAllRanges()
              selection.addRange(range)
            }
          }`
        )
        if (value) await cdp.send('Input.insertText', { text: value })
        else await pressCombo(cdp, 'Delete', 1)
        const now = await callOn<string>(
          cdp,
          ref,
          'function () { return "value" in this ? String(this.value) : this.innerText }'
        )
        return text(`ref=${ref} now holds ${JSON.stringify(now)}.`)
      })
    }
  )

  mcp.registerTool(
    'select_option',
    {
      description: 'Chooses options in a <select> (by ref), by value or visible label.',
      inputSchema: {
        tabId: tabIdInput,
        ref: refInput,
        values: z.array(z.string().max(1000)).min(1).max(100)
      }
    },
    async ({ tabId, ref, values }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const chosen = await callOn<string[] | string>(
          cdp,
          ref,
          `function (wanted) {
            if (this.localName !== 'select') return 'not a <select>: use click for custom dropdowns'
            const options = [...this.options]
            const picked = options.filter((o) => wanted.includes(o.value) || wanted.includes(o.label.trim()))
            if (picked.length === 0) return 'no option matches; options are: ' + options.map((o) => JSON.stringify(o.label.trim())).join(', ')
            for (const o of options) o.selected = this.multiple ? picked.includes(o) || o.selected : o === picked[0]
            this.dispatchEvent(new Event('input', { bubbles: true }))
            this.dispatchEvent(new Event('change', { bubbles: true }))
            return picked.map((o) => o.label.trim())
          }`,
          [values]
        )
        if (typeof chosen === 'string') throw new Error(`ref=${ref}: ${chosen}`)
        return text(
          `Selected ${chosen.map((label) => JSON.stringify(label)).join(', ')} in ref=${ref}.`
        )
      })
    }
  )

  mcp.registerTool(
    'press_key',
    {
      description:
        'Presses a key or combination where the keyboard is (or on an element, by ref, after ' +
        'focusing it): "Enter", "Escape", "Tab", "ArrowDown", "Control+a", "Shift+Tab", "Mod+z" ' +
        '(Mod: Cmd on macOS, Ctrl elsewhere). Nebula’s own shortcuts (Ctrl+W…) are refused.',
      inputSchema: {
        tabId: tabIdInput,
        keys: z.string().min(1).max(50),
        ref: refInput.optional(),
        repeat: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ tabId, keys, ref, repeat = 1 }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        if (ref !== undefined) {
          try {
            await cdp.send('DOM.focus', { backendNodeId: ref })
          } catch (error) {
            if (cdp.dialog) throw error
            throw staleRef(ref)
          }
        }
        const times = repeat > 1 ? ` ×${repeat}` : ''
        return text(
          await act(cdp, tab, `Pressed ${keys}${times}`, () => pressCombo(cdp, keys, repeat))
        )
      })
    }
  )

  mcp.registerTool(
    'scroll',
    {
      description:
        'Scrolls an element (by ref) into view, or scrolls the page up or down with the mouse wheel.',
      inputSchema: {
        tabId: tabIdInput,
        ref: refInput.optional(),
        direction: z.enum(['up', 'down', 'left', 'right']).optional(),
        amount: z
          .number()
          .int()
          .min(1)
          .max(20_000)
          .optional()
          .describe(`px (default ${DEFAULT_SCROLL_PX})`)
      }
    },
    async ({ tabId, ref, direction = 'down', amount = DEFAULT_SCROLL_PX }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        if (ref !== undefined) {
          await centerOf(cdp, ref)
        } else {
          const { cssVisualViewport: view } = await cdp.send<{
            cssVisualViewport: { clientWidth: number; clientHeight: number }
          }>('Page.getLayoutMetrics')
          const sign = direction === 'up' || direction === 'left' ? -1 : 1
          const vertical = direction === 'up' || direction === 'down'
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: view.clientWidth / 2,
            y: view.clientHeight / 2,
            deltaX: vertical ? 0 : sign * amount,
            deltaY: vertical ? sign * amount : 0
          })
          await sleep(SETTLE_MS)
        }
        const position: unknown = await tab.webContents.executeJavaScriptInIsolatedWorld(
          AGENT_WORLD_ID,
          [{ code: '[scrollX, scrollY, document.documentElement.scrollHeight, innerHeight]' }]
        )
        const [sx, sy, height, view] = Array.isArray(position) ? position.map(Number) : []
        const where = ref !== undefined ? `ref=${ref} is in view` : `Scrolled ${direction}`
        return text(
          `${where}. The page is at x=${Math.round(sx)}, y=${Math.round(sy)} of ${Math.round(height)} px ` +
            `(${Math.round(view)} px visible).`
        )
      })
    }
  )

  mcp.registerTool(
    'wait_for',
    {
      description:
        'Waits until text appears on the page, or disappears, or the page has loaded, or just for ' +
        'some seconds.',
      inputSchema: {
        tabId: tabIdInput,
        text: z.string().max(500).optional().describe('Wait until the page shows this'),
        textGone: z
          .string()
          .max(500)
          .optional()
          .describe('Wait until the page no longer shows this'),
        seconds: z
          .number()
          .min(0)
          .max(MAX_WAIT_MS / 1000)
          .optional()
          .describe('Just wait this long'),
        timeout: z
          .number()
          .min(0.1)
          .max(MAX_WAIT_MS / 1000)
          .optional()
          .describe(`Give up after (s, default ${DEFAULT_WAIT_MS / 1000})`)
      }
    },
    async ({ tabId, text: shown, textGone, seconds, timeout }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        if (seconds !== undefined) {
          await sleep(seconds * 1000)
          return text(`Waited ${seconds}s. ${describeLoad(tab)}`)
        }
        const deadline = Date.now() + (timeout ?? DEFAULT_WAIT_MS / 1000) * 1000
        if (tab.webContents.isLoading()) {
          await waitForLoad(tab.webContents, Math.max(0, deadline - Date.now()))
        }
        if (shown === undefined && textGone === undefined)
          return text(`Loaded. ${describeLoad(tab)}`)
        for (;;) {
          if (cdp.dialog) {
            const { type, message } = cdp.dialog
            throw new Error(
              `The page opened ${type}(${JSON.stringify(message)}): answer it with handle_dialog`
            )
          }
          const body = await pageText(tab).catch(() => '')
          const ok =
            (shown === undefined || body.includes(shown)) &&
            (textGone === undefined || !body.includes(textGone))
          if (ok) {
            const what = [
              shown !== undefined && `shows ${JSON.stringify(shown)}`,
              textGone !== undefined && `no longer shows ${JSON.stringify(textGone)}`
            ]
              .filter(Boolean)
              .join(' and ')
            return text(`The page ${what}.`)
          }
          if (Date.now() >= deadline) {
            throw new Error(
              `Gave up waiting: the page still ${shown !== undefined && !body.includes(shown) ? `doesn’t show ${JSON.stringify(shown)}` : `shows ${JSON.stringify(textGone)}`}`
            )
          }
          await sleep(POLL_MS)
        }
      })
    }
  )

  mcp.registerTool(
    'handle_dialog',
    {
      description:
        'Answers the alert, confirm, prompt or "Leave page?" dialog the page has open: accept ' +
        '(OK) or dismiss (Cancel), with text for a prompt.',
      inputSchema: {
        tabId: tabIdInput,
        accept: z.boolean(),
        promptText: z.string().max(10_000).optional()
      }
    },
    async ({ tabId, accept, promptText }) => {
      const { tab, cdp } = page(tabId)
      return context.run(tab, async () => {
        const dialog = cdp.dialog
        if (!dialog) return text('No dialog is open on this tab.')
        await cdp.send('Page.handleJavaScriptDialog', {
          accept,
          ...(promptText !== undefined ? { promptText } : {})
        })
        const answer = accept ? 'Accepted' : 'Dismissed'
        return text(`${answer} ${dialog.type}(${JSON.stringify(dialog.message)}).`)
      })
    }
  )
}
