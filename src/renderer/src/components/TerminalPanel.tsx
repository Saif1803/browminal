import { useRef, type PointerEvent } from 'react'
import { PAGE_INSET, TERMINAL_HEADER_HEIGHT, windowLayout } from '@shared/layout'
import type { TabSummary, TerminalPanelState, TerminalSession } from '@shared/types'
import { useWindowSize } from '../use-window-size'
import { AgentIcon, ChevronDownIcon, CloseIcon, FolderIcon, PlusIcon, TerminalIcon } from './icons'

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

/** Dragging the panel's top edge resizes it (main clamps the height). */
function ResizeHandle(): React.JSX.Element {
  const frame = useRef(0)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const px = Math.round(window.innerHeight - PAGE_INSET - event.clientY)
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => window.browser.setTerminalHeight(Math.max(0, px)))
  }
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      className="absolute inset-x-3 -top-1.5 h-3 cursor-row-resize"
    />
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
 * The terminal panel's header, under the page: the sessions, the tab the active one works on,
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
  const { panel } = windowLayout(width, height, chromeHeight, terminal.height)
  if (!panel) return null
  const session = terminal.sessions.find((other) => other.id === terminal.activeId)
  const tab = tabs.find((other) => other.id === session?.tabId)

  return (
    <section
      aria-label="Terminal"
      className="glass-edge app-no-drag fixed rounded-[10px] bg-console text-[12px]"
      style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height }}
    >
      <ResizeHandle />
      <div className="flex items-center gap-1 px-2" style={{ height: TERMINAL_HEADER_HEIGHT }}>
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
          title={
            tab
              ? `Start Claude Code here, connected to Nebula and working on “${tab.title}”`
              : 'Start Claude Code here, connected to Nebula and working on this tab'
          }
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-accent/15 px-2 font-medium text-accent transition-colors hover:bg-accent/25 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
        >
          <AgentIcon width={13} height={13} />
          Claude
        </button>
        <button
          type="button"
          aria-label="Hide terminal"
          title="Hide terminal (Ctrl+`); shells keep running"
          onClick={() => window.browser.toggleTerminal()}
          className={ICON_BUTTON}
        >
          <ChevronDownIcon width={14} height={14} />
        </button>
      </div>
    </section>
  )
}
