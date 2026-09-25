import { useRef } from 'react'
import { isActive, overallProgress } from '@shared/downloads'
import type { DownloadSummary } from '@shared/types'
import { DownloadIcon } from './icons'

const RING_RADIUS = 14
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

function describe(running: number, progress: number | 'indeterminate' | null): string {
  if (running === 0) return 'Downloads'
  const what = running === 1 ? '1 download' : `${running} downloads`
  const percent = typeof progress === 'number' ? `, ${Math.floor(progress * 100)}%` : ''
  return `Downloads: ${what} in progress${percent}`
}

/** Shown once something has been downloaded. The ring shows progress; a click opens the list. */
export function DownloadsButton({
  downloads
}: {
  downloads: DownloadSummary[]
}): React.JSX.Element | null {
  const ref = useRef<HTMLButtonElement>(null)
  if (downloads.length === 0) return null

  const running = downloads.filter((download) => isActive(download.status)).length
  const progress = overallProgress(downloads)
  const label = describe(running, progress)

  const openMenu = (): void => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    window.browser.showDownloadsMenu(Math.round(rect.left), Math.round(rect.bottom) + 4)
  }

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={openMenu}
      className={`app-no-drag relative grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-field-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${
        running > 0 ? 'text-accent' : 'text-ink-muted'
      }`}
    >
      <DownloadIcon />
      {progress === 'indeterminate' && (
        <span aria-hidden="true" className="tab-spinner absolute inset-0.5" />
      )}
      {typeof progress === 'number' && (
        <svg aria-hidden="true" viewBox="0 0 32 32" className="absolute inset-0 -rotate-90">
          <circle
            cx="16"
            cy="16"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2"
            className="stroke-accent/25"
          />
          <circle
            cx="16"
            cy="16"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - progress)}
            className="stroke-accent transition-[stroke-dashoffset] duration-300"
          />
        </svg>
      )}
    </button>
  )
}
