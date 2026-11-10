import { useEffect, useState } from 'react'
import type { AgentSheet } from '@shared/overlay'
import { AgentIcon, CloseIcon, HomeIcon, PickIcon } from '../components/icons'
import { Button, Keys, SectionTitle, Switch } from './controls'

const close = (): void => window.overlay.close()

/** The sheet's header: its title, the bridge's on/off switch and Close. */
function Header({ on }: { on: boolean }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
      <h2 className="m-0 flex-1 text-[15px] font-semibold">Agents</h2>
      <Switch
        on={on}
        label="Let agents connect"
        onChange={(next) => window.overlay.setAgentsEnabled(next)}
      />
      <button
        type="button"
        aria-label="Close"
        title="Close (Esc)"
        onClick={close}
        className="grid size-[26px] place-items-center rounded-md text-ink-muted hover:bg-field hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}

/** While an agent acts on a tab: which one, and Stop (that tab stops being shared). */
function Working({ working }: { working: NonNullable<AgentSheet['working']> }): React.JSX.Element {
  return (
    <div className="mx-4 mt-3.5 flex items-center gap-2.5 rounded-[10px] bg-accent/12 p-3">
      <span
        aria-hidden="true"
        className="agent-pulse size-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_14%,transparent)]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="font-semibold text-accent">
          {working.here ? 'Agent working on this tab' : 'Agent working on another tab'}
        </span>
        <span className="truncate text-[12px] text-ink-muted">
          {working.here ? 'Stop takes the tab away from agents' : working.title}
        </span>
      </div>
      <Button onClick={() => window.overlay.stopAgent()} className="h-7 px-3">
        Stop
      </Button>
    </div>
  )
}

/** The tile before "Share this tab": the page's icon, or the start page's. */
function TabTile({ tab }: { tab: AgentSheet['tab'] }): React.JSX.Element {
  if (tab.internal) {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-field text-accent">
        <HomeIcon size={16} />
      </span>
    )
  }
  if (tab.favicon) {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-raised ring-1 ring-line">
        <img src={tab.favicon} alt="" className="size-4" />
      </span>
    )
  }
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-accent text-[12px] font-bold text-white dark:text-strip">
      {(tab.title.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

/** "This tab": share it, pick an element on it, and share every tab. */
function ThisTab({
  sheet,
  disabled
}: {
  sheet: AgentSheet
  /** The bridge couldn't start: shown, dimmed. */
  disabled: boolean
}): React.JSX.Element {
  const { tab, shareAll } = sheet
  return (
    <section
      aria-label="This tab"
      className={`flex flex-col gap-3 border-b border-line px-4 py-3.5 ${disabled ? 'pointer-events-none opacity-45' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <TabTile tab={tab} />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="font-semibold">Share this tab</span>
          <span className="truncate text-[12px] text-ink-muted" title={`${tab.title} · ${tab.url}`}>
            {tab.internal ? 'Agents can’t read Browminal pages' : tab.title}
          </span>
        </div>
        <Switch
          on={tab.shared}
          label="Share this tab with agents"
          disabled={disabled || shareAll}
          onChange={(on) => window.overlay.setTabShared(on)}
        />
      </div>
      {!tab.internal && (
        <Button
          onClick={() => window.overlay.pickElement()}
          className="h-8 w-full"
          title="Click an element on the page to send it to the agent"
        >
          <PickIcon size={14} className="text-ink-muted" />
          Pick an element
          <Keys>{sheet.pickShortcut}</Keys>
        </Button>
      )}
      <div className="flex items-center gap-2.5">
        <span className="flex-1">Share every tab</span>
        <Switch
          on={shareAll}
          label="Share every tab with agents"
          disabled={disabled || sheet.status === 'off'}
          onChange={(on) => window.overlay.setShareAll(on)}
        />
      </div>
    </section>
  )
}

/** How to connect Claude Code or another MCP client: the command or the JSON, and Copy. */
function Connect({ connect }: { connect: AgentSheet['connect'] }): React.JSX.Element {
  const [what, setWhat] = useState<'command' | 'config'>('command')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  const options = [
    { id: 'command', label: 'Claude Code' },
    { id: 'config', label: 'MCP config' }
  ] as const
  const text = connect ? connect[what] : 'Starting…'

  return (
    <section aria-label="Connect a client" className="flex flex-col gap-2.5 px-4 py-3.5">
      <SectionTitle>Connect a client</SectionTitle>
      <div
        role="radiogroup"
        aria-label="Client"
        className="flex gap-0.5 rounded-[9px] bg-field p-[3px]"
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={what === option.id}
            onClick={() => setWhat(option.id)}
            className={`h-[26px] flex-1 rounded-[7px] transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              what === option.id
                ? 'bg-raised font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="relative rounded-lg bg-code ring-1 ring-line ring-inset">
        <pre
          className={`m-0 max-h-40 overflow-auto py-2.5 pr-16 pl-3 font-mono text-[11.5px] leading-[1.6] select-text ${
            what === 'command' ? 'break-all whitespace-pre-wrap text-ink' : 'text-ink-muted'
          }`}
        >
          {text}
        </pre>
        <Button
          disabled={!connect}
          onClick={() => {
            window.overlay.copyConnect(what)
            setCopied(true)
          }}
          className="absolute top-2 right-2 h-6 rounded-md px-2.5 text-[12px]"
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="flex-1 text-[12px] leading-normal text-pretty text-ink-muted">
          {what === 'command'
            ? 'Run it once in any terminal.'
            : 'Add it to your client’s MCP settings.'}
        </span>
        <button
          type="button"
          title="Replace the token; disconnects every agent"
          onClick={() => window.overlay.renewToken()}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-ink-muted hover:bg-field hover:text-danger focus-visible:outline-2 focus-visible:outline-accent"
        >
          New token
        </button>
      </div>
    </section>
  )
}

/** Agents are off: what they are, and the way to switch them on. */
function Off(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 pt-7 pb-6.5 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-field text-ink-muted">
        <AgentIcon size={20} />
      </span>
      <span className="text-[15px] font-semibold">Let coding agents in</span>
      <span className="leading-normal text-pretty text-ink-muted">
        Claude Code or any MCP client can then see and drive the tabs you share. Nothing is shared
        until you choose.
      </span>
      <Button
        tone="accent"
        onClick={() => window.overlay.setAgentsEnabled(true)}
        className="mt-1.5 h-8 px-4"
      >
        Let agents connect
      </Button>
    </div>
  )
}

/**
 * The agent sheet ("Connect an agent"), along the page's right side: the bridge's on/off switch,
 * the tab on screen, and how to connect a client (with New token).
 */
export function AgentSheetView({ sheet }: { sheet: AgentSheet }): React.JSX.Element {
  const { status } = sheet
  return (
    <>
      <Header on={status !== 'off'} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {status === 'off' ? (
          <Off />
        ) : (
          <>
            {status === 'error' && (
              <div className="mx-4 mt-3.5 flex flex-col gap-2.5 rounded-[10px] bg-danger/10 p-3">
                <span className="leading-normal text-pretty select-text">{sheet.error}</span>
                <Button
                  onClick={() => window.overlay.retryBridge()}
                  className="h-7 self-start px-3"
                >
                  Try again
                </Button>
              </div>
            )}
            {sheet.working && <Working working={sheet.working} />}
            <ThisTab sheet={sheet} disabled={status === 'error'} />
            {status !== 'error' && <Connect connect={sheet.connect} />}
          </>
        )}
      </div>
    </>
  )
}
