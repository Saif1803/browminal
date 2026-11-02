import { useEffect, useRef, useState } from 'react'
import { PAGE_RADIUS, panelPlacement, windowLayout } from '@shared/layout'
import type { BrowserState } from '@shared/types'
import { isHomeUrl } from '@shared/url'
import { AddressBar } from './components/AddressBar'
import { AgentButton, AgentPicking, AgentWorking, PickSent } from './components/AgentButton'
import { BookmarksBar } from './components/BookmarksBar'
import { DownloadsButton } from './components/DownloadsButton'
import { FindBar } from './components/FindBar'
import { NavButtons } from './components/NavButtons'
import { TabStrip } from './components/TabStrip'
import { TerminalButton, TerminalPanel } from './components/TerminalPanel'
import { useWindowSize } from './use-window-size'

const EMPTY_STATE: BrowserState = {
  tabs: [],
  active: {
    id: 0,
    url: '',
    title: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    isErrorPage: false,
    zoomFactor: 1,
    find: null,
    isBookmarked: false,
    shield: null,
    emulation: null,
    errors: 0
  },
  downloads: [],
  bookmarks: [],
  bookmarksBarVisible: false,
  agent: {
    enabled: false,
    port: null,
    error: null,
    shareAll: false,
    working: null,
    picking: null,
    pick: null
  },
  terminal: { open: false, dock: 'bottom', height: 0, width: 0, sessions: [], activeId: null }
}

/** Reports the header's height to main, which places tabs directly below it; returns it too. */
function useChromeHeight(ref: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let reported = -1
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height === reported) return
      reported = height
      window.browser.setChromeHeight(height)
      setHeight(height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return height
}

function App(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>(EMPTY_STATE)
  // The tab whose address bar should take focus once it's shown (Ctrl+L, a new tab).
  const [focusTabId, setFocusTabId] = useState<number | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const chromeHeight = useChromeHeight(headerRef)

  useEffect(() => {
    let active = true
    // Subscribe first, then fetch, so no update between the two is lost.
    const unsubscribe = window.browser.onState(setState)
    const stopFocusing = window.browser.onFocusAddressBar(setFocusTabId)
    window.browser.getState().then((next) => active && setState(next))
    return () => {
      active = false
      unsubscribe()
      stopFocusing()
    }
  }, [])

  const tab = state.active
  const { agent } = state
  const workingTab = state.tabs.find((other) => other.id === agent.working)
  const activeShared = state.tabs.find((other) => other.id === tab.id)?.agentShared ?? false
  const { terminal } = state
  const windowSize = useWindowSize()
  // Where main put the page (it makes room for the terminal panel), for the agent's ring.
  const { page } = windowLayout(
    windowSize.width,
    windowSize.height,
    chromeHeight,
    terminal.open ? panelPlacement(terminal) : null
  )

  return (
    <>
      <header ref={headerRef} data-platform={window.browser.platform} className="app-drag">
        <TabStrip tabs={state.tabs} activeId={tab.id} />
        <div className="relative flex h-10 items-center gap-2 bg-bar px-2">
          <NavButtons state={tab} />
          {/* Keyed by tab so switching tabs drops anything half-typed in the previous one. */}
          <AddressBar
            key={tab.id}
            url={isHomeUrl(tab.url) ? '' : tab.url}
            isErrorPage={tab.isErrorPage}
            zoomFactor={tab.zoomFactor}
            isBookmarked={tab.isBookmarked}
            shield={tab.shield}
            emulation={tab.emulation}
            onResetEmulation={() => window.browser.resetEmulation(tab.id)}
            errors={tab.errors}
            focusRequested={focusTabId === tab.id}
            onFocused={() => setFocusTabId(null)}
          />
          {agent.picking !== null ? (
            <AgentPicking />
          ) : (
            agent.pick && <PickSent notice={agent.pick} />
          )}
          {workingTab && (
            <AgentWorking
              tabId={workingTab.id}
              title={workingTab.id === tab.id ? null : workingTab.title}
            />
          )}
          <DownloadsButton downloads={state.downloads} />
          <TerminalButton open={terminal.open} />
          <AgentButton agent={agent} shared={activeShared} />
          {tab.isLoading && (
            <div
              role="progressbar"
              aria-label="Loading page"
              className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
            >
              <div className="load-sweep h-full w-2/5 bg-gradient-to-r from-transparent via-accent to-transparent" />
            </div>
          )}
        </div>
        {state.bookmarksBarVisible && state.bookmarks.length > 0 && (
          <BookmarksBar bookmarks={state.bookmarks} />
        )}
        {/* Keyed by tab: each tab has its own find bar and query. */}
        {tab.find && <FindBar key={tab.id} find={tab.find} />}
      </header>
      {workingTab?.id === tab.id && chromeHeight > 0 && (
        <div
          aria-hidden="true"
          className="agent-glow"
          style={{
            top: page.y,
            left: page.x,
            width: page.width,
            height: page.height,
            borderRadius: PAGE_RADIUS
          }}
        />
      )}
      {terminal.open && chromeHeight > 0 && (
        <TerminalPanel
          terminal={terminal}
          tabs={state.tabs}
          activeTabId={tab.id}
          chromeHeight={chromeHeight}
        />
      )}
    </>
  )
}

export default App
