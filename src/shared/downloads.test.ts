import { describe, expect, test } from 'bun:test'
import { describeStatus, formatBytes, isActive, overallProgress, shortenMiddle } from './downloads'
import type { DownloadStatus, DownloadSummary } from './types'

const download = (status: DownloadStatus, receivedBytes = 0, totalBytes = 0): DownloadSummary => ({
  id: 1,
  filename: 'f',
  status,
  receivedBytes,
  totalBytes
})

describe('isActive', () => {
  test('running downloads are active, finished ones are not', () => {
    expect(isActive('progressing')).toBe(true)
    expect(isActive('paused')).toBe(true)
    expect(isActive('interrupted')).toBe(true)
    expect(isActive('completed')).toBe(false)
    expect(isActive('cancelled')).toBe(false)
    expect(isActive('failed')).toBe(false)
  })
})

describe('overallProgress', () => {
  test('null when nothing is running', () => {
    expect(overallProgress([])).toBeNull()
    expect(overallProgress([download('completed', 10, 10), download('failed')])).toBeNull()
  })

  test('adds up running downloads of known size', () => {
    expect(overallProgress([download('progressing', 25, 100)])).toBe(0.25)
    expect(
      overallProgress([
        download('progressing', 50, 100),
        download('paused', 0, 100),
        download('completed', 999, 999)
      ])
    ).toBe(0.25)
  })

  test('ignores unknown sizes unless nothing else is running', () => {
    expect(overallProgress([download('progressing', 10, 0), download('progressing', 1, 2)])).toBe(
      0.5
    )
    expect(overallProgress([download('progressing', 10, 0)])).toBe('indeterminate')
  })

  test('stays within 0–1', () => {
    expect(overallProgress([download('progressing', 150, 100)])).toBe(1)
  })
})

describe('formatBytes', () => {
  test('picks a unit and rounds like Chrome', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB')
    expect(formatBytes(3.25 * 1024 ** 3)).toBe('3.3 GB')
    expect(formatBytes(-5)).toBe('0 B')
  })
})

describe('describeStatus', () => {
  const MB = 1024 * 1024

  test('running downloads show how far along they are', () => {
    expect(describeStatus(download('progressing', 3 * MB, 7 * MB))).toBe('3.0 MB of 7.0 MB')
    expect(describeStatus(download('progressing', 2048, 0))).toBe('2.0 KB so far')
    expect(describeStatus(download('paused', 45, 100))).toBe('Paused, 45%')
    expect(describeStatus(download('paused', 45, 0))).toBe('Paused')
    expect(describeStatus(download('interrupted', 45, 100))).toBe('Interrupted')
  })

  test('finished downloads show their size or what went wrong', () => {
    expect(describeStatus(download('completed', 20 * MB, 20 * MB))).toBe('20 MB')
    expect(describeStatus(download('completed', 2048, 0))).toBe('2.0 KB')
    expect(describeStatus(download('cancelled'))).toBe('Cancelled')
    expect(describeStatus(download('failed'))).toBe('Failed')
  })
})

describe('shortenMiddle', () => {
  test('leaves short text alone', () => {
    expect(shortenMiddle('file.zip', 10)).toBe('file.zip')
  })

  test('cuts the middle and keeps the extension', () => {
    const short = shortenMiddle('a-very-long-file-name-v2.zip', 15)
    expect(short).toBe('a-very-…-v2.zip')
    expect(Array.from(short).length).toBe(15)
  })

  test('never splits an emoji', () => {
    expect(shortenMiddle('😀😀😀😀😀😀', 5)).toBe('😀😀…😀😀')
  })
})
