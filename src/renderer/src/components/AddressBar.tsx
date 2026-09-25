import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { LockIcon, SearchIcon } from './icons'

export function AddressBar({
  url,
  isErrorPage,
  zoomFactor
}: {
  url: string
  isErrorPage: boolean
  zoomFactor: number
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(url)
  const [editing, setEditing] = useState(false)
  // Set on Enter so the blur that follows keeps the typed text until the page navigates.
  const submittedRef = useRef(false)

  // Follow navigations, but never clobber what the user is typing.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(url)
  }, [url])

  useEffect(
    () =>
      window.browser.onFocusAddressBar(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }),
    []
  )

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const input = draft.trim()
    if (!input) return
    window.browser.navigate(input)
    submittedRef.current = true
    inputRef.current?.blur()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') inputRef.current?.blur()
  }

  // An error page shows the URL that failed, but nothing secure was loaded.
  const isSecure = url.startsWith('https://') && !isErrorPage
  const zoomPercent = Math.round(zoomFactor * 100)

  return (
    <form onSubmit={submit} className="app-no-drag min-w-0 flex-1">
      <label className="group flex h-8 items-center gap-2 rounded-lg bg-field px-3 ring-1 ring-transparent transition-[background-color,box-shadow] hover:bg-field-hover focus-within:bg-field focus-within:ring-accent/70">
        <span className="shrink-0 text-ink-faint group-focus-within:text-accent">
          {isSecure && !editing ? (
            <LockIcon width={13} height={13} />
          ) : (
            <SearchIcon width={13} height={13} />
          )}
        </span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setEditing(true)
            e.target.select()
          }}
          onBlur={() => {
            setEditing(false)
            if (!submittedRef.current) setDraft(url)
            submittedRef.current = false
          }}
          onKeyDown={onKeyDown}
          aria-label="Address and search bar"
          placeholder="Search Google or type a URL"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint selection:bg-accent/40"
        />
        {zoomPercent !== 100 && (
          <button
            type="button"
            title="Reset zoom to 100%"
            aria-label={`Zoom ${zoomPercent}%. Reset to 100%`}
            onClick={() => window.browser.resetZoom()}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-muted tabular-nums ring-1 ring-line transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {zoomPercent}%
          </button>
        )}
      </label>
    </form>
  )
}
