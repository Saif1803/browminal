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
    expect(decideNavigation('browminal://error/?url=https://bank.example/')).toBe('block')
    expect(decideNavigation('browminal://home/')).toBe('block')
    expect(decideNavigation('file:///C:/Windows/win.ini')).toBe('block')
    expect(decideNavigation('ms-settings:privacy')).toBe('block')
    expect(decideNavigation('slack://open')).toBe('block')
    expect(decideNavigation('javascript:alert(1)')).toBe('block')
    expect(decideNavigation('not a url')).toBe('block')
  })

  test("Chromium's PDF viewer may load in a frame, and only there", () => {
    const viewer = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/5cec7dfa-dc37-4dab'
    expect(decideNavigation(viewer, { mainFrame: false })).toBe('allow')
    expect(decideNavigation(viewer, { mainFrame: true })).toBe('block')
    expect(decideNavigation(viewer)).toBe('block')
    expect(
      decideNavigation('chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/x', {
        mainFrame: false
      })
    ).toBe('block')
    expect(decideNavigation('chrome://settings/', { mainFrame: false })).toBe('block')
  })
})
