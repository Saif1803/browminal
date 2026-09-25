import { describe, expect, test } from 'bun:test'
import { safeFilename, uniqueFilename } from './download-names'

describe('safeFilename', () => {
  test('keeps ordinary names', () => {
    expect(safeFilename('report.pdf')).toBe('report.pdf')
    expect(safeFilename('Photo 2026 (final).JPG')).toBe('Photo 2026 (final).JPG')
    expect(safeFilename('résumé 日本.txt')).toBe('résumé 日本.txt')
  })

  test('drops folders', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd')
    expect(safeFilename('C:\\Windows\\evil.exe')).toBe('evil.exe')
    expect(safeFilename('dir/')).toBe('download')
  })

  test('replaces characters Windows rejects', () => {
    expect(safeFilename('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt')
    expect(safeFilename('tab\there\u0000.txt')).toBe('tab_here_.txt')
  })

  test('removes leading and trailing dots and spaces', () => {
    expect(safeFilename('  notes.txt  ')).toBe('notes.txt')
    expect(safeFilename('file.txt...')).toBe('file.txt')
    expect(safeFilename('.bashrc')).toBe('bashrc')
  })

  test('never names a file after a Windows device', () => {
    expect(safeFilename('CON')).toBe('_CON')
    expect(safeFilename('nul.txt')).toBe('_nul.txt')
    expect(safeFilename('com1.tar.gz')).toBe('_com1.tar.gz')
    expect(safeFilename('console.log')).toBe('console.log')
  })

  test('falls back to "download" when nothing is left', () => {
    expect(safeFilename('')).toBe('download')
    expect(safeFilename('...')).toBe('download')
    expect(safeFilename('   ')).toBe('download')
  })

  test('shortens long names but keeps the extension', () => {
    const name = safeFilename(`${'a'.repeat(300)}.zip`)
    expect(name.length).toBe(200)
    expect(name.endsWith('a.zip')).toBe(true)
  })
})

describe('uniqueFilename', () => {
  const taken =
    (...names: string[]) =>
    (name: string): boolean =>
      names.includes(name)

  test('keeps a free name', () => {
    expect(uniqueFilename('file.zip', taken())).toBe('file.zip')
  })

  test('numbers a taken name before the extension', () => {
    expect(uniqueFilename('file.zip', taken('file.zip'))).toBe('file (1).zip')
    expect(uniqueFilename('file.zip', taken('file.zip', 'file (1).zip'))).toBe('file (2).zip')
  })

  test('keeps compound extensions together', () => {
    expect(uniqueFilename('src.tar.gz', taken('src.tar.gz'))).toBe('src (1).tar.gz')
  })

  test('handles names without an extension', () => {
    expect(uniqueFilename('README', taken('README'))).toBe('README (1)')
  })

  test('gives up counting eventually', () => {
    expect(uniqueFilename('a.txt', () => true)).toMatch(/^a \(\d{13,}\)\.txt$/)
  })
})
