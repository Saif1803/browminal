import { describe, expect, test } from 'bun:test'
import {
  HOME_URL,
  SEARCH_URL,
  displayUrl,
  errorPageUrl,
  isHomeUrl,
  parseErrorPageUrl,
  resolveInput
} from './url'

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

describe('search and home', () => {
  test('searches Google, not DuckDuckGo', () => {
    expect(resolveInput('best pizza')).toBe('https://www.google.com/search?q=best%20pizza')
  })

  test('home URL is the internal page', () => {
    expect(HOME_URL).toBe('browminal://home/')
    expect(isHomeUrl('browminal://home/')).toBe(true)
    expect(isHomeUrl('browminal://home/#x')).toBe(true)
    expect(isHomeUrl('https://browminal.home/')).toBe(false)
  })

  test('typing the internal scheme does not load it', () => {
    expect(resolveInput('browminal://home/')).toBe(search('browminal://home/'))
  })
})

describe('error pages', () => {
  test('round-trips the code and failed URL', () => {
    const url = errorPageUrl('ERR_NAME_NOT_RESOLVED', 'https://a.example/x?y=1&z=2#frag')
    expect(url.startsWith('browminal://error/?')).toBe(true)
    expect(parseErrorPageUrl(url)).toEqual({
      code: 'ERR_NAME_NOT_RESOLVED',
      url: 'https://a.example/x?y=1&z=2#frag'
    })
  })

  test('the address bar shows the failed URL', () => {
    const failed = 'http://localhost:5173/'
    expect(displayUrl(errorPageUrl('ERR_CONNECTION_REFUSED', failed))).toBe(failed)
    expect(displayUrl('https://example.com/')).toBe('https://example.com/')
    expect(displayUrl(HOME_URL)).toBe(HOME_URL)
  })

  test('only http(s) failed URLs are accepted', () => {
    expect(parseErrorPageUrl(errorPageUrl('X', 'javascript:alert(1)'))).toBeNull()
    expect(parseErrorPageUrl(errorPageUrl('X', 'browminal://home/'))).toBeNull()
    expect(parseErrorPageUrl('browminal://error/?code=X')).toBeNull()
    expect(displayUrl('browminal://error/?url=file:///etc/passwd')).toBe(
      'browminal://error/?url=file:///etc/passwd'
    )
  })

  test('other pages are not error pages', () => {
    expect(parseErrorPageUrl('https://example.com/?url=https://a.example/')).toBeNull()
    expect(parseErrorPageUrl('browminal://errorx/?url=https://a.example/')).toBeNull()
  })
})
