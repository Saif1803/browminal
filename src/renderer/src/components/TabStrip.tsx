import { useEffect, useRef, type MouseEvent, type WheelEvent } from 'react'
import { TAB_STRIP_HEIGHT } from '@shared/layout'
import type { TabSummary } from '@shared/types'
import { isHomeUrl } from '@shared/url'
import {
  AgentIcon,
  CloseIcon,
  GlobeIcon,
  HomeIcon,
  MutedIcon,
  PlusIcon,
  SpeakerIcon
} from './icons'

// Clicks on a tab's own buttons must not also activate or close the tab.
const stop = (event: MouseEvent): void => event.stopPropagation()

function TabIcon({ tab }: { tab: TabSummary }): React.JSX.Element {
  if (tab.isLoading) return <span aria-hidden="true" className="tab-spinner size-3.5 shrink-0" />
  if (tab.favicon) return <img src={tab.favicon} alt="" className="size-4 shrink-0" />
  if (isHomeUrl(tab.url)) return <HomeIcon size={14} className="shrink-0 text-accent" />
  return <GlobeIcon size={14} className="shrink-0 text-ink-faint" />
}

function Tab({ tab, isActive }: { tab: TabSummary; isActive: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { browser } = window

  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [isActive])

  const onMouseDown = (event: MouseEvent): void => {
    // Activate on press, like other browsers; the middle button would start autoscroll.
    if (event.button === 0 && !isActive) browser.activateTab(tab.id)
    if (event.button === 1) event.preventDefault()
  }

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) browser.closeTab(tab.id)
  }

  const showAudio = tab.isAudible || tab.isMuted

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={isActive}
      title={tab.title}
      onMouseDown={onMouseDown}
      onAuxClick={onAuxClick}
      className={`app-no-drag group relative flex h-8 w-56 min-w-12 shrink items-center gap-2 rounded-lg pr-1.5 pl-3 text-[12px] transition-colors ${
        isActive ? 'glass-edge bg-tab text-ink' : 'text-ink-muted hover:bg-field/60 hover:text-ink'
      }`}
    >
      <TabIcon tab={tab} />
      <span className="min-w-0 flex-1 truncate">{tab.title || 'Untitled'}</span>
      {tab.agentShared && (
        <span role="img" aria-label="Shared with agents" title="Shared with agents">
          <AgentIcon size={14} className="shrink-0 text-accent" />
        </span>
      )}
      {showAudio && (
        <button
          type="button"
          aria-label={tab.isMuted ? 'Unmute tab' : 'Mute tab'}
          title={tab.isMuted ? 'Unmute tab' : 'Mute tab'}
          onMouseDown={stop}
          onClick={() => browser.toggleMute(tab.id)}
          className="grid size-5 shrink-0 place-items-center rounded text-ink-muted hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          {tab.isMuted ? <MutedIcon size={14} /> : <SpeakerIcon size={14} />}
        </button>
      )}
      <button
        type="button"
        aria-label="Close tab"
        title="Close tab"
        onMouseDown={stop}
        onAuxClick={stop}
        onClick={() => browser.closeTab(tab.id)}
        className={`grid size-5 shrink-0 place-items-center rounded text-ink-muted hover:bg-field-hover hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent ${
          isActive ? '' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}

export function TabStrip({
  tabs,
  activeId
}: {
  tabs: TabSummary[]
  activeId: number
}): React.JSX.Element {
  // A mouse wheel scrolls the strip sideways once tabs overflow.
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.deltaX === 0) event.currentTarget.scrollLeft += event.deltaY
  }

  return (
    <div
      className="titlebar-safe flex items-center gap-1 pt-1 pl-2"
      style={{ height: TAB_STRIP_HEIGHT }}
    >
      <div
        role="tablist"
        aria-label="Tabs"
        onWheel={onWheel}
        className="no-scrollbar flex min-w-0 items-center gap-px overflow-x-auto"
      >
        {tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} isActive={tab.id === activeId} />
        ))}
      </div>
      <button
        type="button"
        aria-label="New tab"
        title="New tab"
        onClick={() => window.browser.newTab()}
        className="app-no-drag grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <PlusIcon size={16} />
      </button>
    </div>
  )
}
