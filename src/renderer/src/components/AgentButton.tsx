import type { AgentState, PickNotice } from '@shared/types'
import { AgentIcon, PickIcon } from './icons'

function describe(agent: AgentState, shared: boolean): string {
  if (!agent.enabled) return 'Agents: off'
  if (agent.error) return `Agents can’t connect: ${agent.error}`
  return shared ? 'Agents: this tab is shared' : 'Agents: this tab is not shared'
}

/**
 * Opens the agent sheet over the page: share this tab, switch agents on/off, how to connect.
 * Tinted while the tab is shared, ringed while the sheet is open, dotted when agents can't connect.
 */
export function AgentButton({
  agent,
  shared,
  open
}: {
  agent: AgentState
  /** Whether the active tab is shared with agents. */
  shared: boolean
  /** The sheet is open. */
  open: boolean
}): React.JSX.Element {
  const label = describe(agent, shared)
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      title={label}
      onClick={() => window.browser.toggleAgentSheet()}
      className={`app-no-drag relative grid size-8 shrink-0 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
        shared
          ? 'bg-accent/15 text-accent hover:bg-accent/25'
          : 'text-ink-muted hover:bg-field-hover hover:text-ink'
      } ${open ? 'ring-[1.5px] ring-accent ring-inset' : ''}`}
    >
      <AgentIcon />
      {agent.enabled && agent.error && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 right-1.5 size-[7px] rounded-full bg-danger ring-2 ring-strip"
        />
      )}
    </button>
  )
}

const CHIP =
  'app-no-drag flex h-7 shrink-0 items-center gap-2 rounded-full bg-accent/15 text-[12px] text-accent'

/** Shown while the user picks an element for agents (Ctrl+Shift+X): how, and Cancel (or Esc). */
export function AgentPicking(): React.JSX.Element {
  return (
    <div role="status" className={`${CHIP} pr-1 pl-2.5`}>
      <PickIcon size={14} />
      <span className="whitespace-nowrap">Click an element to send it to the agent</span>
      <button
        type="button"
        onClick={() => window.browser.cancelPick()}
        title="Stop picking (Esc)"
        className="rounded-full px-2 py-0.5 font-medium hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent"
      >
        Cancel
      </button>
    </div>
  )
}

function noticeText({ id, kind, typed, error }: PickNotice): string {
  if (error !== null) return `Couldn’t pick: ${error}`
  const what = kind === 'element' ? 'Element' : 'Errors'
  return typed
    ? `${what} sent: pick ${id} is in the agent’s prompt`
    : `${what} sent as pick ${id}: ask your agent about it`
}

/** For a few seconds after a pick: where it went. */
export function PickSent({ notice }: { notice: PickNotice }): React.JSX.Element {
  const text = noticeText(notice)
  return (
    <div role="status" title={text} className={`${CHIP} px-3`}>
      <PickIcon size={14} className="shrink-0" />
      <span className="max-w-72 truncate">{text}</span>
    </div>
  )
}

/** Shown while an agent acts on a tab: what it's working on, and Stop (stops sharing that tab). */
export function AgentWorking({
  tabId,
  title
}: {
  tabId: number
  /** The tab's title when it isn't the active tab; null when it is. */
  title: string | null
}): React.JSX.Element {
  return (
    <div
      role="status"
      className="app-no-drag flex h-7 shrink-0 items-center gap-2 rounded-full bg-accent/15 pr-1 pl-3 text-[12px] text-accent"
    >
      <span aria-hidden="true" className="agent-pulse size-1.5 rounded-full bg-accent" />
      <span className="max-w-48 truncate">
        {title ? `Agent working in “${title}”` : 'Agent working'}
      </span>
      <button
        type="button"
        onClick={() => window.browser.stopAgent(tabId)}
        title="Stop the agent: this tab stops being shared"
        className="rounded-full px-2 py-0.5 font-medium hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-accent"
      >
        Stop
      </button>
    </div>
  )
}
