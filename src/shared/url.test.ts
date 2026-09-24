import { describe, expect, test } from 'bun:test'
import { HOME_URL, SEARCH_URL, resolveInput } from './url'

const search = (q: string): string => SEARCH_URL + encodeURIComponent(q)

describe('resolveInput', () => {
  test('keeps full http(s) URLs', () => {
    expect(resolveInput('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(resolveInput('http://example.com')).toBe('http://example.com')
    expect(resolveInput('  HTTPS://Example.com  ')).toBe('HTTPS://Example.com')
  })

  test('adds https:// to bare domains', () => {
    expect(resolveInput('example.com')).toBe('https://example.com')
    expect(resolveInput('github.com/electron/electron')).toBe(
      'https://github.com/electron/electron'
    )
    expect(resolveInput('sub.example.co.uk:8443/x#y')).toBe('https://sub.example.co.uk:8443/x#y')
  })

  test('adds http:// to localhost and IPs', () => {
    expect(resolveInput('localhost')).toBe('http://localhost')
    expect(resolveInput('localhost:5173/app')).toBe('http://localhost:5173/app')
    expect(resolveInput('192.168.1.10:8080')).toBe('http://192.168.1.10:8080')
  })

  test('searches everything else', () => {
    expect(resolveInput('electron web contents view')).toBe(search('electron web contents view'))
    expect(resolveInput('hello')).toBe(search('hello'))
    expect(resolveInput('3.14')).toBe(search('3.14'))
    expect(resolveInput('what is example.com')).toBe(search('what is example.com'))
  })

  test('never loads non-http schemes', () => {
    expect(resolveInput('javascript:alert(1)')).toBe(search('javascript:alert(1)'))
    expect(resolveInput('file:///C:/Windows/win.ini')).toBe(search('file:///C:/Windows/win.ini'))
    expect(resolveInput('ftp://example.com')).toBe(search('ftp://example.com'))
  })

  test('empty input goes home', () => {
    expect(resolveInput('   ')).toBe(HOME_URL)
  })
})
