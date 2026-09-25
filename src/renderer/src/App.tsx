import { useEffect, useRef, useState } from 'react'
import type { BrowserState } from '@shared/types'
import { isHomeUrl } from '@shared/url'
import { AddressBar } from './components/AddressBar'
import { NavButtons } from './components/NavButtons'
import { TabStrip } from './components/TabStrip'

const EMPTY_STATE: BrowserState = {
  tabs: [],
  active: {
    id: 0,
    url: '',
    title: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false
  }
}

/** Reports the header's height to main, which places tabs directly below it. */
function useChromeHeight(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let reported = -1
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height === reported) return
      reported = height
      window.browser.setChromeHeight(height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
}

function App(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>(EMPTY_STATE)
  const headerRef = useRef<HTMLElement>(null)
  useChromeHeight(headerRef)

  useEffect(() => {
    let active = true
    // Subscribe first, then fetch, so no update between the two is lost.
    const unsubscribe = window.browser.onState(setState)
    window.browser.getState().then((next) => active && setState(next))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const tab = state.active

  return (
    <header ref={headerRef} data-platform={window.browser.platform} className="app-drag">
      <TabStrip tabs={state.tabs} activeId={tab.id} />
      <div className="relative flex h-[44px] items-center gap-2 bg-bar px-2">
        <NavButtons state={tab} />
        {/* Keyed by tab so switching tabs drops anything half-typed in the previous one. */}
        <AddressBar key={tab.id} url={isHomeUrl(tab.url) ? '' : tab.url} />
        {tab.isLoading && (
          <div
            role="progressbar"
            aria-label="Loading page"
            className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
          >
            <div className="load-sweep h-full w-2/5 bg-gradient-to-r from-transparent via-plasma to-transparent" />
          </div>
        )}
      </div>
    </header>
  )
}

export default App
