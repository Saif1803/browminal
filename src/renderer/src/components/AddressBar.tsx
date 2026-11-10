import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ShieldState } from '@shared/types'
import { isHttpUrl } from '@shared/url'
import { CloseIcon, ErrorIcon, LockIcon, SearchIcon, StarIcon } from './icons'
import { ShieldButton } from './ShieldButton'

export function AddressBar({
  url,
  isErrorPage,
  zoomFactor,
  isBookmarked,
  shield,
  emulation,
  onResetEmulation,
  errors,
  errorsOpen,
  prompting,
  focusRequested,
  onFocused
}: {
  url: string
  isErrorPage: boolean
  zoomFactor: number
  isBookmarked: boolean
  shield: ShieldState | null
  /** What an agent emulates on the tab ("iPhone 15 · dark"), shown as a badge; null for none. */
  emulation: string | null
  onResetEmulation: () => void
  /** New errors on a shared tab's page, shown as a badge that sends them to agents; 0 for none. */
  errors: number
  /** The errors popover is open (the badge looks pressed). */
  errorsOpen: boolean
  /** A question hangs from the leading icon (a site's permission request…): it's highlighted. */
  prompting: boolean
  /** Take the keyboard now (Ctrl+L, a new tab); call onFocused once done. */
  focusRequested: boolean
  onFocused: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
  const [draft, setDraft] = useState(url)
  const [editing, setEditing] = useState(false)
  // Set on Enter so the blur that follows keeps the typed text until the page navigates.
  const submittedRef = useRef(false)
  // Set when the keyboard went to another view while editing (a menu over the window, the
  // page): the text stays as typed, and the field doesn't select it all when focus comes back.
  const awayRef = useRef(false)

  // Follow navigations, but never clobber what the user is typing.
  useEffect(() => {
    if (document.activeElement !== inputRef.current || !document.hasFocus()) setDraft(url)
  }, [url])

  // Questions for the user hang from the leading icon: tell main where it is.
  useEffect(() => {
    const icon = iconRef.current
    const field = icon?.closest('label')
    if (!icon || !field) return
    const report = (): void => {
      const left = icon.getBoundingClientRect().left
      const bottom = field.getBoundingClientRect().bottom
      window.browser.setPromptAnchor(
        Math.max(0, Math.round(left - 12)),
        Math.max(0, Math.round(bottom))
      )
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(field)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [])

  useEffect(() => {
    if (!focusRequested) return
    inputRef.current?.focus()
    inputRef.current?.select()
    onFocused()
  }, [focusRequested, onFocused])

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
  const bookmarkHint = window.browser.platform === 'darwin' ? '⌘D' : 'Ctrl+D'
  const bookmarkLabel = isBookmarked ? 'Remove bookmark' : 'Bookmark this page'

  return (
    <form onSubmit={submit} className="app-no-drag min-w-0 flex-1">
      <label className="glass-edge group relative flex h-8 items-center gap-2 rounded-lg bg-field px-3 ring-1 ring-transparent transition-[background-color,box-shadow] hover:bg-field-hover focus-within:bg-field focus-within:ring-accent/70">
        <span
          ref={iconRef}
          className={`-mx-1 grid size-[21px] shrink-0 place-items-center rounded-md transition-colors group-focus-within:text-accent ${
            prompting ? 'bg-accent/15 text-accent' : 'text-ink-faint'
          }`}
        >
          {isSecure && !editing ? <LockIcon size={14} /> : <SearchIcon size={14} />}
        </span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => {
            setEditing(true)
            if (!awayRef.current) e.target.select()
            awayRef.current = false
          }}
          onPointerDown={() => (awayRef.current = false)}
          onBlur={() => {
            setEditing(false)
            // The window's other views took the keyboard; it may come straight back (a menu).
            if (!document.hasFocus() && !submittedRef.current) {
              awayRef.current = true
              return
            }
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
        {emulation && (
          <button
            type="button"
            title="An agent is emulating this on the tab. Click to go back to normal."
            aria-label={`Emulating ${emulation}. Reset`}
            onClick={onResetEmulation}
            className="group/emu flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap text-accent ring-1 ring-accent/50 transition-colors hover:bg-field-hover focus-visible:outline-2 focus-visible:outline-accent"
          >
            {emulation}
            <CloseIcon size={12} className="opacity-60 group-hover/emu:opacity-100" />
          </button>
        )}
        {errors > 0 && (
          <button
            type="button"
            title="New errors on this page. Click to see them and send them to the agent."
            aria-label={`${errors} new error${errors === 1 ? '' : 's'} on this page`}
            aria-expanded={errorsOpen}
            aria-haspopup="dialog"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              // The popover's right edge lines up with the badge's, a little to its right.
              window.browser.toggleErrors(
                Math.min(Math.round(rect.right) + 4, window.innerWidth),
                Math.round(rect.bottom)
              )
            }}
            className={`flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-danger/12 px-2 text-[12px] font-semibold whitespace-nowrap text-danger tabular-nums transition-colors hover:bg-danger/20 focus-visible:outline-2 focus-visible:outline-accent ${
              errorsOpen ? 'ring-[1.5px] ring-danger' : ''
            }`}
          >
            <ErrorIcon size={12} />
            {errors > 99 ? '99+' : errors}
          </button>
        )}
        {shield && <ShieldButton shield={shield} />}
        {isHttpUrl(url) && (
          <button
            type="button"
            title={`${bookmarkLabel} (${bookmarkHint})`}
            aria-label={bookmarkLabel}
            onClick={() => window.browser.toggleBookmark()}
            className={`-mr-1.5 grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-field-hover focus-visible:outline-2 focus-visible:outline-accent ${
              isBookmarked ? 'text-accent' : 'text-ink-faint hover:text-ink'
            }`}
          >
            <StarIcon size={16} fill={isBookmarked ? 'currentColor' : 'none'} />
          </button>
        )}
      </label>
    </form>
  )
}
