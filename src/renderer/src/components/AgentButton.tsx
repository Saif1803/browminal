import { useRef } from 'react'
import type { AgentState } from '@shared/types'
import { AgentIcon } from './icons'

function describe(agent: AgentState, shared: boolean): string {
  if (!agent.enabled) return 'Agents: off'
  if (agent.error) return `Agents can’t connect: ${agent.error}`
  return shared ? 'Agents: this tab is shared' : 'Agents: this tab is not shared'
}

/** Opens the agent menu: share this tab, switch agents on/off, copy the connect command. */
export function AgentButton({
  agent,
  shared
}: {
  agent: AgentState
  /** Whether the active tab is shared with agents. */
  shared: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const label = describe(agent, shared)

  const openMenu = (): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    window.browser.showAgentMenu(Math.round(rect.left), Math.round(rect.bottom) + 4)
  }

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={openMenu}
      className={`app-no-drag relative grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${
        shared ? 'text-accent' : 'text-ink-muted'
      }`}
    >
      <AgentIcon />
      {agent.error && (
        <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-ink" />
      )}
    </button>
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
