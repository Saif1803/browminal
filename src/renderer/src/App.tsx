import { useEffect, useState } from 'react'
import type { TabState } from '@shared/types'
import { isHomeUrl } from '@shared/url'
import { AddressBar } from './components/AddressBar'
import { NavButtons } from './components/NavButtons'

const EMPTY_STATE: TabState = {
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false
}

function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabState>(EMPTY_STATE)

  useEffect(() => {
    let active = true
    // Subscribe first, then fetch, so no update between the two is lost.
    const unsubscribe = window.browser.onTabState(setTab)
    window.browser.getState().then((state) => active && setTab(state))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <header data-platform={window.browser.platform} className="app-drag relative h-[44px]">
      <div className="titlebar-safe flex h-full items-center gap-2 pl-2">
        <NavButtons state={tab} />
        <AddressBar url={isHomeUrl(tab.url) ? '' : tab.url} />
      </div>
      {tab.isLoading && (
        <div
          role="progressbar"
          aria-label="Loading page"
          className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
        >
          <div className="load-sweep h-full w-2/5 bg-gradient-to-r from-transparent via-plasma to-transparent" />
        </div>
      )}
    </header>
  )
}

export default App
