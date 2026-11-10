import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_DEFAULT_WIDTH,
  TERMINAL_EXIT_BAR_HEIGHT,
  TERMINAL_HEADER_HEIGHT,
  TERMINAL_MIN_HEIGHT,
  TERMINAL_MIN_WIDTH,
  TERMINAL_TAB_ROW_HEIGHT,
  panelPlacement,
  windowLayout,
  type PanelDock
} from '@shared/layout'
import {
  MAX_AGENT_COMMAND,
  MCP_CONFIG_PLACEHOLDER,
  type TabSummary,
  type TerminalPanelState,
  type TerminalSession
} from '@shared/types'
import { agentBrand } from '@shared/agents'
import { useWindowSize } from '../use-window-size'
import {
  AgentIcon,
  AgentLogo,
  CloseIcon,
  FolderIcon,
  GlobeIcon,
  PanelBottomIcon,
  PanelRightIcon,
  PlusIcon,
  TerminalIcon
} from './icons'

/** Arrow keys on the resize handle move it this far (four times with Shift). */
const RESIZE_STEP = 24
/** Asked for by End; main clamps it to what the window allows. */
const LARGEST_SIZE = 10_000
/** Narrower than this, the agent button shows only its icon. */
const COMPACT_PANEL_WIDTH = 720

/** A keyboard-only ring: clicks never show it. */
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

/** The header's controls are all 28px tall, with fills (never borders) for hover and state. */
const ICON_BUTTON = `grid size-7 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-field hover:text-ink ${FOCUS}`

const PILL_BUTTON = `flex h-[30px] shrink-0 items-center gap-2 rounded-lg px-3 font-medium whitespace-nowrap transition-[background-color,filter] ${FOCUS}`

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
      {/* A grip in the middle of the gap, always there; the edge lights up while it's used. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-full bg-field-hover transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 group-data-dragging:opacity-0 ${
          bottom ? 'top-[4px] left-1/2 -ml-[18px] h-1 w-9' : 'top-1/2 left-[4px] -mt-[18px] h-9 w-1'
        }`}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute rounded-full bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-dragging:opacity-100 ${
          bottom ? 'inset-x-0 top-[4.5px] h-[3px]' : 'inset-y-0 left-[4.5px] w-[3px]'
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
  const state = session.exited ? ' (exited)' : ''
  return (
    <div
      className={`group flex h-7 shrink-0 items-center gap-0.5 rounded-md pr-1 pl-2 text-[12.5px] transition-colors ${
        isActive
          ? 'bg-field font-medium text-ink'
          : 'text-ink-muted hover:bg-field/60 hover:text-ink'
      }`}
    >
      <button
        type="button"
        onClick={() => window.browser.selectTerminal(session.id)}
        aria-current={isActive || undefined}
        title={`${session.title}${state}\nIn ${session.folder}`}
        className="flex max-w-44 items-center gap-1.5 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <SessionIcon session={session} isActive={isActive} />
        <span className="truncate">{session.title}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${session.title}`}
        title="Close terminal (ends its shell)"
        onClick={() => window.browser.closeTerminal(session.id)}
        className={`grid size-5 place-items-center rounded text-ink-faint transition-colors hover:bg-field-hover hover:text-ink focus-visible:opacity-100 ${FOCUS} ${
          isActive ? '' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}

/** What a session is, lit while it's the one shown: an agent, a shell, or exited. */
function SessionIcon({
  session,
  isActive
}: {
  session: TerminalSession
  isActive: boolean
}): React.JSX.Element {
  if (session.exited) {
    return (
      <span aria-label="Exited" className="grid size-3.5 shrink-0 place-items-center">
        <span className="size-1.5 rounded-full bg-danger" />
      </span>
    )
  }
  if (session.agent) {
    // Claude's and Codex's marks keep their colours, muted while the session is in the back.
    const dim = session.brand
      ? 'opacity-55 grayscale group-hover:opacity-100 group-hover:grayscale-0'
      : 'text-ink-faint group-hover:text-accent'
    return (
      <AgentLogo
        brand={session.brand}
        size={14}
        className={`shrink-0 transition-[opacity,filter,color] ${isActive ? 'text-accent' : dim}`}
      />
    )
  }
  return (
    <TerminalIcon
      aria-hidden="true"
      size={14}
      className={`shrink-0 transition-colors ${isActive ? 'text-ink' : 'text-ink-faint'}`}
    />
  )
}

/** Where the panel sits: two icons, the current one lit (a segmented switch). */
function DockSwitch({ dock }: { dock: PanelDock }): React.JSX.Element {
  const options = [
    { dock: 'bottom', label: 'Terminal under the page', Icon: PanelBottomIcon },
    { dock: 'right', label: 'Terminal beside the page', Icon: PanelRightIcon }
  ] as const
  return (
    <div
      role="group"
      aria-label="Terminal position"
      className="flex shrink-0 items-center gap-px rounded-md bg-field/60 p-0.5"
    >
      {options.map((option) => {
        const current = option.dock === dock
        return (
          <button
            key={option.dock}
            type="button"
            aria-label={option.label}
            aria-pressed={current}
            title={option.label}
            onClick={() => {
              if (!current) window.browser.setTerminalDock(option.dock)
            }}
            className={`grid size-6 place-items-center rounded-[5px] transition-colors ${FOCUS} ${
              current
                ? 'bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.18)]'
                : 'text-ink-faint hover:text-ink'
            }`}
          >
            <option.Icon size={14} />
          </button>
        )
      })}
    </div>
  )
}

/** Which tab the terminal's agent works on, and a way to point it at the tab on screen. */
function WorksOn({
  session,
  tab,
  activeTabId,
  pill
}: {
  session: TerminalSession
  tab: TabSummary | undefined
  activeTabId: number
  /** In the header row (bottom dock); else a row of its own. */
  pill: boolean
}): React.JSX.Element {
  const onOtherTab = session.tabId !== activeTabId
  const title = tab ? tab.title || 'Untitled' : null
  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 text-[12px] text-ink-muted ${pill ? 'h-7' : 'h-6 w-full'}`}
      title={title ? `Agents started here work on: ${title}` : undefined}
    >
      {tab?.favicon ? (
        <img src={tab.favicon} alt="" className="size-3.5 shrink-0 rounded-[3px]" />
      ) : (
        <GlobeIcon aria-hidden="true" size={14} className="shrink-0 text-ink-faint" />
      )}
      <span className="min-w-0 truncate">
        {title ? (
          <>
            Works on <span className="font-medium text-ink">{title}</span>
          </>
        ) : (
          'Works on no tab'
        )}
      </span>
      {onOtherTab && (
        <button
          type="button"
          onClick={() => window.browser.attachTerminal(session.id)}
          className={`h-6 shrink-0 rounded-md px-2 font-medium text-accent transition-colors hover:bg-accent/12 ${FOCUS}`}
        >
          Use this tab
        </button>
      )}
    </div>
  )
}

/** At most this many agent commands at the field's end, besides the one in it. */
const SUGGESTIONS_SHOWN = 3

/**
 * The start page, shown while no session is: the project folder the agent works in (by name,
 * never its path; chosen once per site) and the agent to run (claude, codex or any command),
 * then "Start session" on the active tab. A plain terminal is a link away.
 */
function StartPage({
  terminal,
  tab
}: {
  terminal: TerminalPanelState
  /** The active tab, which the session will work on. */
  tab: TabSummary | undefined
}): React.JSX.Element {
  const [command, setCommand] = useState(terminal.agentCommands[0] ?? '')
  const [starting, setStarting] = useState(false)
  const trimmed = command.trim()
  const suggestions = terminal.agentCommands
    .filter((other) => other !== trimmed)
    .slice(0, SUGGESTIONS_SHOWN)

  const start = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!trimmed || starting) return
    setStarting(true)
    window.browser.startAgentSession(trimmed).finally(() => setStarting(false))
  }

  return (
    <div className="no-scrollbar flex flex-1 overflow-y-auto">
      <form onSubmit={start} className="m-auto flex w-full max-w-[640px] flex-col gap-3 px-5 py-4">
        <div className="min-w-0 text-center">
          <h2 className="text-[14px] font-semibold text-ink">Start an agent session</h2>
          <p className="truncate text-[12px] text-ink-muted">
            Works on{' '}
            <span className="font-medium text-ink">
              {tab ? tab.title || 'Untitled' : 'this tab'}
            </span>
          </p>
        </div>

        {/* Project and agent side by side; they wrap onto two rows when the panel is narrow. */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="flex min-w-[200px] flex-1 items-center gap-2.5">
            <span id="start-folder" className="shrink-0 text-[12px] text-ink-muted">
              Project
            </span>
            <button
              type="button"
              aria-labelledby="start-folder"
              title={
                terminal.site
                  ? `The folder the agent works in, remembered for ${terminal.site}`
                  : 'The folder the agent works in'
              }
              onClick={() => window.browser.chooseTerminalFolder()}
              className={`flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-lg bg-field px-2.5 text-left text-[12.5px] transition-colors hover:bg-field-hover ${FOCUS}`}
            >
              <FolderIcon size={14} className="shrink-0 text-ink-muted" />
              {terminal.folder ? (
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {terminal.folder}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-ink-faint">Choose a folder…</span>
              )}
              {terminal.folder && (
                <span className="shrink-0 text-[11.5px] text-accent">Change</span>
              )}
            </button>
          </div>

          <div className="flex min-w-[200px] flex-1 items-center gap-2.5">
            <label htmlFor="start-agent" className="shrink-0 text-[12px] text-ink-muted">
              Agent
            </label>
            {/* The field shows whose agent the command runs (Claude's or Codex's mark, else a bot);
                the agents used before sit at its end as marks, one click to switch. */}
            <div className="flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-lg bg-field pr-1 pl-2.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent">
              <AgentLogo
                brand={agentBrand(command)}
                size={14}
                className={`shrink-0 ${agentBrand(command) ? '' : 'text-ink-muted'}`}
              />
              <input
                id="start-agent"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                maxLength={MAX_AGENT_COMMAND}
                placeholder="claude, codex, or any agent command"
                title={`Claude Code and Codex connect to Browminal by themselves. For another agent, put ${MCP_CONFIG_PLACEHOLDER} where it takes an MCP config file.`}
                className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-faint"
              />
              {suggestions.length > 0 && (
                <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setCommand(suggestion)}
                      title={`Use ${suggestion}`}
                      aria-label={`Use ${suggestion}`}
                      className={`flex h-6 w-6 items-center justify-center rounded-md opacity-60 transition hover:bg-field-hover hover:opacity-100 ${FOCUS}`}
                    >
                      <AgentLogo
                        brand={agentBrand(suggestion)}
                        size={14}
                        className={agentBrand(suggestion) ? '' : 'text-ink-muted'}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="submit"
            disabled={!trimmed || starting}
            className={`${PILL_BUTTON} bg-accent font-semibold text-white hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100 dark:text-console`}
          >
            <AgentIcon size={14} />
            {terminal.folder ? 'Start session' : 'Choose folder and start'}
          </button>
          <button
            type="button"
            onClick={() => window.browser.newTerminal()}
            className={`rounded text-[12px] text-ink-muted hover:text-ink hover:underline ${FOCUS}`}
          >
            or a plain terminal{' '}
            <kbd className="font-mono text-[11px] text-ink-faint">Ctrl+Shift+`</kbd>
          </button>
        </div>
      </form>
    </div>
  )
}

/** Under an exited shell: its exit code, Close and Restart. */
function ExitBar({ session }: { session: TerminalSession }): React.JSX.Element {
  return (
    <div
      role="status"
      className="absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-b-[10px] bg-field/50 pr-2 pl-4"
      style={{ height: TERMINAL_EXIT_BAR_HEIGHT }}
    >
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
        {session.exitCode === null ? (
          'The shell has exited'
        ) : (
          <>
            Process exited with code{' '}
            <span
              className={`font-mono ${session.exitCode === 0 ? 'text-ink-muted' : 'text-danger'}`}
            >
              {session.exitCode}
            </span>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={() => window.browser.closeTerminal(session.id)}
        className={`${PILL_BUTTON} h-7 text-ink-muted hover:bg-field hover:text-ink`}
      >
        Close
      </button>
      <button
        type="button"
        onClick={() => window.browser.restartTerminal(session.id)}
        className={`${PILL_BUTTON} h-7 bg-raised text-ink hover:bg-field-hover`}
      >
        Restart
      </button>
    </div>
  )
}

/**
 * The terminal panel, under the page or beside it: the same rounded surface as the page, so the
 * window reads as two panes. Its header has the sessions on the left, then the tab agents act
 * on, then the panel's controls; on the right the tab gets a row of its own. The terminal itself
 * is main's terminal view, placed below the header (and above the exit bar of an exited shell).
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
  const bottom = dock === 'bottom'
  const compact = !bottom || panel.width < COMPACT_PANEL_WIDTH
  const session = terminal.sessions.find((other) => other.id === terminal.activeId)
  const tab = tabs.find((other) => other.id === session?.tabId)
  const activeTab = tabs.find((other) => other.id === activeTabId)

  return (
    <section
      aria-label="Terminal"
      className="glass-edge app-no-drag fixed flex flex-col rounded-[10px] bg-console text-[12px]"
      style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height }}
    >
      <ResizeHandle dock={dock} size={bottom ? panel.height : panel.width} />
      <div
        className="flex shrink-0 items-center gap-1 overflow-hidden px-2"
        style={{ height: TERMINAL_HEADER_HEIGHT }}
      >
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
          <PlusIcon />
        </button>
        <div className="min-w-3 flex-1" />
        {bottom && session && (
          <div className="mr-2 flex min-w-0 shrink justify-end">
            <WorksOn session={session} tab={tab} activeTabId={activeTabId} pill />
          </div>
        )}
        <button
          type="button"
          onClick={() => window.browser.showTerminalStartPage()}
          aria-label="New agent session"
          aria-pressed={!session}
          title="New agent session: choose the project folder and the agent (Claude Code, Codex, any other)"
          className={`group flex h-7 shrink-0 items-center gap-1.5 rounded-md font-medium transition-colors ${FOCUS} ${
            compact ? 'w-7 justify-center' : 'pr-2.5 pl-2 text-[12.5px]'
          } ${session ? 'text-ink-muted hover:bg-field hover:text-ink' : 'bg-accent/15 text-accent'}`}
        >
          <AgentIcon className="text-accent" />
          {!compact && 'Agent'}
        </button>
        <DockSwitch dock={dock} />
        <button
          type="button"
          aria-label="Hide terminal"
          title="Hide terminal (Ctrl+`); shells keep running"
          onClick={() => window.browser.toggleTerminal()}
          className={ICON_BUTTON}
        >
          <CloseIcon />
        </button>
      </div>
      {!bottom && session && (
        <div className="flex shrink-0 items-start px-4" style={{ height: TERMINAL_TAB_ROW_HEIGHT }}>
          <WorksOn session={session} tab={tab} activeTabId={activeTabId} pill={false} />
        </div>
      )}
      {!bottom && !session && (
        <div className="shrink-0" style={{ height: TERMINAL_TAB_ROW_HEIGHT }} />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!session && <StartPage terminal={terminal} tab={activeTab} />}
        {session?.exited && <ExitBar session={session} />}
      </div>
    </section>
  )
}
