import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent
} from 'react'
import { TAB_STRIP_HEIGHT } from '@shared/layout'
import {
  clampDrag,
  dropIndex,
  movedIds,
  TAB_DRAG_THRESHOLD,
  tabShift,
  type TabBox
} from '@shared/tab-drag'
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

// Clicks on a tab's own buttons must not also activate, close or drag the tab.
const stop = (event: MouseEvent | PointerEvent): void => event.stopPropagation()

/** A press on a tab, and once it has moved far enough, the drag along the strip. */
interface Drag {
  id: number
  pointerId: number
  startX: number
  /** Set once the pointer passes the threshold: the strip's tabs as measured then. */
  boxes: TabBox[] | null
  from: number
  dx: number
}

/** How one tab is drawn while a drag is on. */
interface TabDragStyle {
  /** px along the strip: the dragged tab follows the pointer, the others step aside. */
  offset: number
  isDragged: boolean
}

function TabIcon({ tab }: { tab: TabSummary }): React.JSX.Element {
  if (tab.isLoading) return <span aria-hidden="true" className="tab-spinner size-3.5 shrink-0" />
  if (tab.favicon) return <img src={tab.favicon} alt="" className="size-4 shrink-0" />
  if (isHomeUrl(tab.url)) return <HomeIcon size={14} className="shrink-0 text-accent" />
  return <GlobeIcon size={14} className="shrink-0 text-ink-faint" />
}

function Tab({
  tab,
  isActive,
  drag,
  onPointerDown
}: {
  tab: TabSummary
  isActive: boolean
  drag: TabDragStyle | null
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
}): React.JSX.Element {
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

  const onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    browser.showTabMenu(tab.id, Math.round(event.clientX), Math.round(event.clientY))
  }

  const showAudio = tab.isAudible || tab.isMuted
  // While a drag is on, the other tabs glide aside; nothing animates once the tab is dropped
  // (the strip's new order puts every tab where it already shows).
  const motion = drag && !drag.isDragged ? 'transition-[transform,color,background-color]' : ''

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={isActive}
      title={tab.title}
      data-tab-id={tab.id}
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      style={drag && drag.offset !== 0 ? { transform: `translateX(${drag.offset}px)` } : undefined}
      className={`app-no-drag group relative flex h-8 w-56 min-w-12 shrink touch-none items-center gap-2 rounded-lg pr-1.5 pl-3 text-[12px] ${
        motion || 'transition-colors'
      } ${drag?.isDragged ? 'z-10' : ''} ${
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
          onPointerDown={stop}
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
        onPointerDown={stop}
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

/** The strip in the order to draw: a drop shows its new order until main's state has it. */
function inOrder(tabs: TabSummary[], ids: number[] | null): TabSummary[] {
  if (!ids) return tabs
  const byId = new Map(tabs.map((tab) => [tab.id, tab]))
  const placed = ids.flatMap((id) => byId.get(id) ?? [])
  return [...placed, ...tabs.filter((tab) => !ids.includes(tab.id))]
}

const sameOrder = (tabs: TabSummary[], ids: number[]): boolean =>
  tabs.length === ids.length && tabs.every((tab, i) => tab.id === ids[i])

export function TabStrip({
  tabs,
  activeId
}: {
  tabs: TabSummary[]
  activeId: number
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // After a drop: the order shown until a state push from main has caught up with it.
  const [dropped, setDropped] = useState<{ ids: number[]; settled: boolean } | null>(null)
  // Every state push from main (adjusted during render, so no frame shows the stale state).
  const [seenTabs, setSeenTabs] = useState(tabs)
  if (seenTabs !== tabs) {
    setSeenTabs(tabs)
    // Main's new order comes in the push after moveTab returns; any push after that wins.
    if (dropped && (dropped.settled || sameOrder(tabs, dropped.ids))) setDropped(null)
    // A tab opened, closed or moved by someone else mid-drag: the measured strip is stale.
    const ids = seenTabs.map((tab) => tab.id)
    if (drag && !sameOrder(tabs, ids)) setDrag(null)
  }
  const ordered = inOrder(tabs, dropped?.ids ?? null)

  // A mouse wheel scrolls the strip sideways once tabs overflow.
  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.deltaX === 0) event.currentTarget.scrollLeft += event.deltaY
  }

  const startDrag = (tab: TabSummary, event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || drag) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      id: tab.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      boxes: null,
      from: ordered.indexOf(tab),
      dx: 0
    })
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.startX
    if (drag.boxes) {
      setDrag({ ...drag, dx: clampDrag(drag.boxes, drag.from, dx) })
      return
    }
    if (Math.abs(dx) < TAB_DRAG_THRESHOLD || !listRef.current) return
    const boxes = [...listRef.current.querySelectorAll<HTMLElement>('[data-tab-id]')].map(
      (element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, width: rect.width }
      }
    )
    if (boxes.length < 2) return
    setDrag({ ...drag, boxes, dx: clampDrag(boxes, drag.from, dx) })
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>, drop: boolean): void => {
    if (!drag || event.pointerId !== drag.pointerId) return
    setDrag(null)
    if (!drop || !drag.boxes) return
    const to = dropIndex(drag.boxes, drag.from, drag.dx)
    if (to === drag.from) return
    const ids = movedIds(
      ordered.map((tab) => tab.id),
      drag.id,
      to
    )
    setDropped({ ids, settled: false })
    void window.browser
      .moveTab(drag.id, to)
      .finally(() => setDropped((now) => (now?.ids === ids ? { ids, settled: true } : now)))
  }

  const dragStyle = (index: number): TabDragStyle | null => {
    if (!drag?.boxes) return null
    const { boxes, from, dx } = drag
    if (index === from) return { offset: dx, isDragged: true }
    const gap = boxes[1].left - (boxes[0].left + boxes[0].width)
    const step = boxes[from].width + gap
    return { offset: tabShift(index, from, dropIndex(boxes, from, dx), step), isDragged: false }
  }

  return (
    <div
      className="titlebar-safe flex items-center gap-1 pt-1 pl-2"
      style={{ height: TAB_STRIP_HEIGHT }}
    >
      <div
        ref={listRef}
        role="tablist"
        aria-label="Tabs"
        onWheel={onWheel}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, true)}
        onPointerCancel={(event) => endDrag(event, false)}
        className="no-scrollbar flex min-w-0 items-center gap-px overflow-x-auto"
      >
        {ordered.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeId}
            drag={dragStyle(index)}
            onPointerDown={(event) => startDrag(tab, event)}
          />
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
