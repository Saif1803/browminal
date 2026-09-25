import { useRef } from 'react'
import type { ShieldState } from '@shared/types'
import { ShieldIcon, ShieldOffIcon } from './icons'

function describe({ status, site, blocked }: ShieldState): string {
  switch (status) {
    case 'on':
      return blocked === 1 ? 'Ad blocker: 1 blocked' : `Ad blocker: ${blocked} blocked`
    case 'paused':
      return `Ad blocker: paused on ${site}`
    case 'off':
      return 'Ad blocker: off'
    case 'loading':
      return 'Ad blocker: downloading filter lists'
    case 'unavailable':
      return "Ad blocker: filter lists couldn't be downloaded"
  }
}

/** The ad blocker in the address bar: how many requests it blocked here. A click opens its menu. */
export function ShieldButton({ shield }: { shield: ShieldState }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const { status, blocked } = shield
  const isOn = status === 'on' || status === 'loading'
  const showCount = status === 'on' && blocked > 0
  const label = describe(shield)

  const openMenu = (): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    window.browser.showAdblockMenu(Math.round(rect.left), Math.round(rect.bottom) + 4)
  }

  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      onClick={openMenu}
      className={`flex h-6 shrink-0 items-center gap-1 rounded-md px-1 transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${
        showCount ? 'text-accent' : 'text-ink-faint'
      }`}
    >
      {isOn ? <ShieldIcon width={14} height={14} /> : <ShieldOffIcon width={14} height={14} />}
      {showCount && (
        <span className="text-[11px] font-medium tabular-nums">
          {blocked > 999 ? '999+' : blocked}
        </span>
      )}
    </button>
  )
}
