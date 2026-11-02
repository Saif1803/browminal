import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_DEFAULT_WIDTH,
  TERMINAL_HEADER_HEIGHT,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
  panelPlacement,
  windowLayout,
  type PanelDock
} from '@shared/layout'
import type { TabSummary, TerminalPanelState, TerminalSession } from '@shared/types'
import { useWindowSize } from '../use-window-size'
import {
  AgentIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FolderIcon,
  PanelBottomIcon,
  PanelRightIcon,
  PlusIcon,
  TerminalIcon
} from './icons'

/** Arrow keys on the resize handle move it this far (four times with Shift). */
const RESIZE_STEP = 24
/** Asked for by End; main clamps it to what the window allows. */
const LARGEST_SIZE = 10_000
/** Narrower than this, the Claude button shows only its icon. */
const COMPACT_PANEL_WIDTH = 480

const ICON_BUTTON =
  'grid size-6 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent'

/** The toolbar's terminal button: shows or hides the panel (Ctrl+`). */
export function TerminalButton({ open }: { open: boolean }): React.JSX.Element {
  const label = open ? 'Hide terminal (Ctrl+`)' : 'Terminal (Ctrl+`)'
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={open}
      title={label}
      onClick={() => window.browser.toggleTerminal()}
      className={`app-no-drag grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${
        open ? 'text-accent' : 'text-ink-muted'
      }`}
    >
      <TerminalIcon />
    </button>
  )
}

/**
 * The panel's inner edge, in the gap between it and the page (its top at the bottom, its left
 * side on the right). Drag it, or focus it and use the arrow keys, to resize; double-click puts
 * back the default size. `size` is the panel's size on screen; main clamps what is asked for.
 */
function ResizeHandle({ dock, size }: { dock: PanelDock; size: number }): React.JSX.Element {
  const bottom = dock === 'bottom'
  const drag = useRef<{ from: number; size: number } | null>(null)
  const frame = useRef(0)
  const [dragging, setDragging] = useState(false)

  const position = (event: PointerEvent): number => (bottom ? event.clientY : event.clientX)
  const resize = (px: number): void => {
    const size = Math.min(Math.max(0, Math.round(px)), LARGEST_SIZE)
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => window.browser.setTerminalSize(size))
  }
  const endDrag = (): void => {
    drag.current = null
    setDragging(false)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    drag.current = { from: position(event), size }
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    // The inner edge follows the pointer: up (or left) makes the panel bigger.
    resize(drag.current.size + drag.current.from - position(event))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 4 * RESIZE_STEP : RESIZE_STEP
    let px: number
    if (event.key === (bottom ? 'ArrowUp' : 'ArrowLeft')) px = size + step
    else if (event.key === (bottom ? 'ArrowDown' : 'ArrowRight')) px = size - step
    else if (event.key === 'Home') px = 0
    else if (event.key === 'End') px = LARGEST_SIZE
    else return
    event.preventDefault()
    resize(px)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      // The separator runs along the edge: a horizontal line above a bottom panel.
      aria-orientation={bottom ? 'horizontal' : 'vertical'}
      aria-label={bottom ? 'Resize terminal height' : 'Resize terminal width'}
      aria-valuenow={size}
      aria-valuemin={bottom ? TERMINAL_MIN_HEIGHT : TERMINAL_MIN_WIDTH}
      title="Drag to resize · double-click for the default size"
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => resize(bottom ? TERMINAL_DEFAULT_HEIGHT : TERMINAL_DEFAULT_WIDTH)}
      onKeyDown={onKeyDown}
      className={`group absolute z-10 focus-visible:outline-none ${
        bottom
          ? 'inset-x-3 -top-2 h-3 cursor-row-resize'
          : 'inset-y-3 -left-2 w-3 cursor-col-resize'
      }`}
    >
      {/* A line in the middle of the gap while the edge is hovered, focused or dragged. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-dragging:opacity-100 ${
          bottom ? 'inset-x-0 top-[3px] h-0.5' : 'inset-y-0 left-[3px] w-0.5'
        }`}
      />
    </div>
  )
}

function SessionTab({
  session,
  isActive
}: {
  session: TerminalSession
  isActive: boolean
}): React.JSX.Element {
  return (
    <div
      className={`group flex h-6 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 ${
        isActive ? 'bg-field text-ink' : 'text-ink-muted hover:bg-field/60 hover:text-ink'
      }`}
    >
      <button
        type="button"
        onClick={() => window.browser.selectTerminal(session.id)}
        title={session.cwd}
        className={`max-w-36 truncate focus-visible:outline-none ${session.exited ? 'line-through opacity-70' : ''}`}
      >
        {session.title}
      </button>
      <button
        type="button"
        aria-label={`Close ${session.title}`}
        title="Close terminal (ends its shell)"
        onClick={() => window.browser.closeTerminal(session.id)}
        className={`grid size-4 place-items-center rounded hover:bg-field-hover focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent ${
          isActive ? '' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <CloseIcon width={10} height={10} />
      </button>
    </div>
  )
}

/** Which tab the terminal's agent works on, and a way to point it at the tab on screen. */
function TabChip({
  session,
  tab,
  activeTabId
}: {
  session: TerminalSession
  tab: TabSummary | undefined
  activeTabId: number
}): React.JSX.Element {
  const onOtherTab = session.tabId !== activeTabId
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-ink-muted">
      <span
        className="min-w-0 truncate"
        title={tab ? `Agents started here work on: ${tab.title}` : undefined}
      >
        {tab ? `Works on: ${tab.title || 'Untitled'}` : 'Works on no tab'}
      </span>
      {onOtherTab && (
        <button
          type="button"
          onClick={() => window.browser.attachTerminal(session.id)}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-accent hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-accent"
        >
          Use this tab
        </button>
      )}
    </div>
  )
}

/**
 * The terminal panel's header, under the page or beside it: the sessions, the tab the active one works on,
 * and its actions. The terminal itself is main's terminal view, placed right below this row.
 */
export function TerminalPanel({
  terminal,
  tabs,
  activeTabId,
  chromeHeight
}: {
  terminal: TerminalPanelState
  tabs: TabSummary[]
  activeTabId: number
  chromeHeight: number
}): React.JSX.Element | null {
  const { width, height } = useWindowSize()
  const { dock } = terminal
  const { panel } = windowLayout(width, height, chromeHeight, panelPlacement(terminal))
  if (!panel) return null
  const compact = panel.width < COMPACT_PANEL_WIDTH
  const toRight = dock === 'bottom'
  const session = terminal.sessions.find((other) => other.id === terminal.activeId)
  const tab = tabs.find((other) => other.id === session?.tabId)

  return (
    <section
      aria-label="Terminal"
      className="glass-edge app-no-drag fixed rounded-[10px] bg-console text-[12px]"
      style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height }}
    >
      <ResizeHandle dock={dock} size={dock === 'bottom' ? panel.height : panel.width} />
      <div
        className="flex items-center gap-1 overflow-hidden px-2"
        style={{ height: TERMINAL_HEADER_HEIGHT }}
      >
        <TerminalIcon width={14} height={14} className="mr-1 shrink-0 text-ink-faint" />
        <div className="no-scrollbar flex min-w-0 shrink items-center gap-0.5 overflow-x-auto">
          {terminal.sessions.map((other) => (
            <SessionTab key={other.id} session={other} isActive={other.id === terminal.activeId} />
          ))}
        </div>
        <button
          type="button"
          aria-label="New terminal"
          title="New terminal for this tab (Ctrl+Shift+`)"
          onClick={() => window.browser.newTerminal()}
          className={ICON_BUTTON}
        >
          <PlusIcon width={13} height={13} />
        </button>
        <div className="mx-2 flex min-w-0 flex-1 justify-end">
          {session && <TabChip session={session} tab={tab} activeTabId={activeTabId} />}
        </div>
        <button
          type="button"
          aria-label="Open a terminal in a project folder"
          title={`Open a terminal in a project folder (remembered for this site)${session ? `\nNow: ${session.cwd}` : ''}`}
          onClick={() => window.browser.chooseTerminalFolder()}
          className={ICON_BUTTON}
        >
          <FolderIcon width={14} height={14} />
        </button>
        <button
          type="button"
          disabled={!session || session.exited}
          onClick={() => session && window.browser.startAgentInTerminal(session.id)}
          aria-label="Start Claude Code here"
          title={
            tab
              ? `Start Claude Code here, connected to Nebula and working on “${tab.title}”`
              : 'Start Claude Code here, connected to Nebula and working on this tab'
          }
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-accent/15 px-2 font-medium text-accent transition-colors hover:bg-accent/25 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
        >
          <AgentIcon width={13} height={13} />
          {!compact && 'Claude'}
        </button>
        <button
          type="button"
          aria-label={toRight ? 'Move terminal to the right' : 'Move terminal to the bottom'}
          title={
            toRight
              ? 'Move the terminal beside the page (side by side)'
              : 'Move the terminal under the page (stacked)'
          }
          onClick={() => window.browser.setTerminalDock(toRight ? 'right' : 'bottom')}
          className={ICON_BUTTON}
        >
          {toRight ? (
            <PanelRightIcon width={14} height={14} />
          ) : (
            <PanelBottomIcon width={14} height={14} />
          )}
        </button>
        <button
          type="button"
          aria-label="Hide terminal"
          title="Hide terminal (Ctrl+`); shells keep running"
          onClick={() => window.browser.toggleTerminal()}
          className={ICON_BUTTON}
        >
          {dock === 'bottom' ? (
            <ChevronDownIcon width={14} height={14} />
          ) : (
            <ChevronRightIcon width={14} height={14} />
          )}
        </button>
      </div>
    </section>
  )
}
