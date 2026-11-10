import type { ButtonHTMLAttributes, ReactNode } from 'react'

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

/** An on/off switch. */
export function Switch({
  on,
  label,
  disabled = false,
  onChange
}: {
  on: boolean
  /** What it switches, for screen readers (the row's text says it on screen). */
  label: string
  disabled?: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-[34px] shrink-0 rounded-full transition-colors disabled:opacity-45 ${FOCUS} ${
        on ? 'bg-accent' : 'bg-field ring-1 ring-line ring-inset'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[3px] size-3.5 rounded-full transition-[left,background-color] ${
          on ? 'left-[17px] bg-white' : 'left-[3px] bg-ink-muted'
        }`}
      />
    </button>
  )
}

type Tone = 'raised' | 'accent' | 'quiet' | 'danger' | 'danger-outline'

const TONES: Record<Tone, string> = {
  raised: 'pop-button font-medium text-ink hover:bg-field-hover',
  accent: 'bg-accent font-semibold text-white hover:brightness-110 dark:text-strip',
  quiet: 'font-medium text-ink-muted hover:bg-field hover:text-ink',
  danger: 'bg-danger font-semibold text-white hover:brightness-110',
  'danger-outline': 'font-medium text-danger ring-1 ring-line ring-inset hover:bg-danger/10'
}

/** A popover button. */
export function Button({
  tone = 'raised',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`flex h-[30px] shrink-0 items-center justify-center gap-2 rounded-lg px-3.5 whitespace-nowrap transition-[background-color,filter] disabled:pointer-events-none disabled:opacity-45 ${FOCUS} ${TONES[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

/** A small section title ("This tab"). */
export function SectionTitle({ children }: { children: ReactNode }): React.JSX.Element {
  return <h3 className="m-0 text-[12px] font-semibold text-ink-faint">{children}</h3>
}

/** A keyboard shortcut written after a button's label. */
export function Keys({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="font-mono text-[11px] font-normal text-ink-faint">{children}</kbd>
}
