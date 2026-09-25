import type { ReactNode } from 'react'
import type { ActiveTabState } from '@shared/types'
import { BackIcon, ForwardIcon, HomeIcon, ReloadIcon, StopIcon } from './icons'

function NavButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="app-no-drag grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-plasma disabled:pointer-events-none disabled:text-ink-faint"
    >
      {children}
    </button>
  )
}

export function NavButtons({ state }: { state: ActiveTabState }): React.JSX.Element {
  const { browser } = window
  const reloadHint = browser.platform === 'darwin' ? '⌘R' : 'Ctrl+R'

  return (
    <div className="flex items-center gap-0.5">
      <NavButton label="Back" disabled={!state.canGoBack} onClick={() => browser.back()}>
        <BackIcon />
      </NavButton>
      <NavButton label="Forward" disabled={!state.canGoForward} onClick={() => browser.forward()}>
        <ForwardIcon />
      </NavButton>
      {state.isLoading ? (
        <NavButton label="Stop loading" onClick={() => browser.stop()}>
          <StopIcon />
        </NavButton>
      ) : (
        <NavButton label={`Reload (${reloadHint})`} onClick={() => browser.reload()}>
          <ReloadIcon />
        </NavButton>
      )}
      <NavButton label="Home" onClick={() => browser.home()}>
        <HomeIcon />
      </NavButton>
    </div>
  )
}
