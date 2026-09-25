import type { DownloadStatus, DownloadSummary } from './types'

/** Still running: the download isn't finished and can go on (or be cancelled). */
export function isActive(status: DownloadStatus): boolean {
  return status === 'progressing' || status === 'paused' || status === 'interrupted'
}

/**
 * Progress across all active downloads, 0–1. 'indeterminate' when none of them know their
 * size; null when nothing is downloading. Downloads of unknown size don't count otherwise.
 */
export function overallProgress(downloads: DownloadSummary[]): number | 'indeterminate' | null {
  const active = downloads.filter((download) => isActive(download.status))
  if (active.length === 0) return null
  const sized = active.filter((download) => download.totalBytes > 0)
  if (sized.length === 0) return 'indeterminate'
  const received = sized.reduce((sum, download) => sum + download.receivedBytes, 0)
  const total = sized.reduce((sum, download) => sum + download.totalBytes, 0)
  return Math.min(1, Math.max(0, received / total))
}

/** "a-very-long-file-name-v2.zip" → "a-very-lo…-v2.zip": keeps the end, where the extension is. */
export function shortenMiddle(text: string, maxLength: number): string {
  const chars = Array.from(text)
  if (chars.length <= maxLength) return text
  const tail = Math.floor((maxLength - 1) / 2)
  const head = maxLength - 1 - tail
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** 0 B, 512 B, 1.5 KB, 12 MB, 3.2 GB (1 KB = 1024 B, like Chrome). */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}

/** One line about where a download is: "3.1 of 7.0 MB", "Paused, 45%", "Failed". */
export function describeStatus({ status, receivedBytes, totalBytes }: DownloadSummary): string {
  const size = totalBytes > 0 ? formatBytes(totalBytes) : ''
  const percent = totalBytes > 0 ? `${Math.floor((receivedBytes / totalBytes) * 100)}%` : ''
  switch (status) {
    case 'progressing':
      return totalBytes > 0
        ? `${formatBytes(receivedBytes)} of ${size}`
        : `${formatBytes(receivedBytes)} so far`
    case 'paused':
      return percent ? `Paused, ${percent}` : 'Paused'
    case 'interrupted':
      return 'Interrupted'
    case 'completed':
      return size || formatBytes(receivedBytes)
    case 'cancelled':
      return 'Cancelled'
    case 'failed':
      return 'Failed'
  }
}
