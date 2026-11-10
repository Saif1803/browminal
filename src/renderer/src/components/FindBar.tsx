import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { FindState } from '@shared/types'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from './icons'

function FindButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="app-no-drag grid size-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:text-ink-faint"
    >
      {children}
    </button>
  )
}

/** Find in page for the active tab. Main does the searching; this shows the query and "3 of 12". */
export function FindBar({ find }: { find: FindState }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  // Local so typing stays instant; main only hears about it.
  const [query, setQuery] = useState(find.query)
  const { browser } = window

  useEffect(() => {
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    focus()
    return browser.onFocusFind(focus)
  }, [browser])

  const onChange = (value: string): void => {
    setQuery(value)
    browser.find(value)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      browser.findNext(!event.shiftKey)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      browser.closeFind()
    }
  }

  const hasMatches = find.matches > 0
  const status = !query ? '' : hasMatches ? `${find.activeMatch} of ${find.matches}` : 'No results'

  return (
    <div className="flex h-10 items-center gap-2 border-t border-line bg-bar px-3">
      <label className="flex h-7 w-72 max-w-full min-w-0 items-center gap-2 rounded-md bg-field px-2.5 ring-1 ring-transparent focus-within:ring-accent/70">
        <SearchIcon size={14} className="shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Find in page"
          placeholder="Find in page"
          spellCheck={false}
          autoComplete="off"
          className="app-no-drag min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint selection:bg-accent/40"
        />
        <span
          aria-live="polite"
          className={`shrink-0 text-[12px] tabular-nums ${query && !hasMatches ? 'text-ink-faint' : 'text-ink-muted'}`}
        >
          {status}
        </span>
      </label>
      <FindButton
        label="Previous match (Shift+Enter)"
        disabled={!hasMatches}
        onClick={() => browser.findNext(false)}
      >
        <ChevronUpIcon size={16} />
      </FindButton>
      <FindButton
        label="Next match (Enter)"
        disabled={!hasMatches}
        onClick={() => browser.findNext(true)}
      >
        <ChevronDownIcon size={16} />
      </FindButton>
      <FindButton label="Close find bar (Esc)" onClick={() => browser.closeFind()}>
        <CloseIcon size={12} />
      </FindButton>
    </div>
  )
}
