import { describe, expect, test } from 'bun:test'
import { decideNavigation } from './navigation-policy'

describe('decideNavigation', () => {
  test('web pages navigate freely on the web', () => {
    expect(decideNavigation('https://example.com/a')).toBe('allow')
    expect(decideNavigation('http://localhost:3000/')).toBe('allow')
    expect(decideNavigation('about:blank')).toBe('allow')
    expect(decideNavigation('about:srcdoc')).toBe('allow')
    expect(decideNavigation('data:text/html,<p>frame</p>')).toBe('allow')
    expect(decideNavigation('blob:https://example.com/0f3c')).toBe('allow')
  })

  test('mail and phone links ask to open another app', () => {
    expect(decideNavigation('mailto:someone@example.com')).toBe('external')
    expect(decideNavigation('tel:+15551234567')).toBe('external')
    expect(decideNavigation('MAILTO:someone@example.com')).toBe('external')
  })

  test('internal pages, files and other apps are blocked', () => {
    expect(decideNavigation('nebula://error/?url=https://bank.example/')).toBe('block')
    expect(decideNavigation('nebula://home/')).toBe('block')
    expect(decideNavigation('file:///C:/Windows/win.ini')).toBe('block')
    expect(decideNavigation('ms-settings:privacy')).toBe('block')
    expect(decideNavigation('slack://open')).toBe('block')
    expect(decideNavigation('javascript:alert(1)')).toBe('block')
    expect(decideNavigation('not a url')).toBe('block')
  })
})
