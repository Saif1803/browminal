import { describe, expect, test } from 'bun:test'
import { launchUrl } from './launch-args'

const EXE = 'C:\\Program Files\\Browminal\\Browminal.exe'

describe('launchUrl', () => {
  test('takes an http(s) URL from the command line', () => {
    expect(launchUrl([EXE, 'https://example.com/a?b=1'])).toBe('https://example.com/a?b=1')
    expect(launchUrl([EXE, 'http://localhost:5173'])).toBe('http://localhost:5173/')
    expect(launchUrl([EXE, 'HTTPS://Example.com'])).toBe('https://example.com/')
  })

  test('skips switches and the app path', () => {
    expect(launchUrl([EXE, '--allow-file-access-from-files', 'https://a.test'])).toBe(
      'https://a.test/'
    )
    expect(launchUrl([EXE, 'https://a.test', '--some-switch=https://b.test'])).toBe(
      'https://a.test/'
    )
    expect(launchUrl(['https://first-is-the-exe.test'])).toBeNull()
    expect(launchUrl([])).toBeNull()
  })

  test('ignores everything that is not a web page', () => {
    for (const arg of [
      'browminal://home/',
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'mailto:a@b.test',
      'example.com',
      'search words',
      'C:\\Users\\me\\project',
      '.',
      'https://'
    ]) {
      expect(launchUrl([EXE, arg])).toBeNull()
    }
  })

  test('the last URL wins', () => {
    expect(launchUrl([EXE, 'https://a.test', 'https://b.test'])).toBe('https://b.test/')
  })
})
