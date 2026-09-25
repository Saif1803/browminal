import { describe, expect, test } from 'bun:test'
import {
  PermissionMemory,
  checkFor,
  describeRequest,
  permissionOrigin,
  policyFor
} from './permission-policy'

describe('policyFor', () => {
  test('fullscreen and clipboard writes are allowed without asking', () => {
    expect(policyFor('fullscreen')).toEqual({ action: 'allow' })
    expect(policyFor('clipboard-sanitized-write')).toEqual({ action: 'allow' })
  })

  test('screen sharing (media without camera or microphone) passes through to the screen picker', () => {
    expect(policyFor('media', [])).toEqual({ action: 'allow' })
  })

  test('camera and microphone are asked, together when requested together', () => {
    expect(policyFor('media', ['video'])).toEqual({ action: 'ask', kinds: ['camera'] })
    expect(policyFor('media', ['audio'])).toEqual({ action: 'ask', kinds: ['microphone'] })
    expect(policyFor('media', ['audio', 'video'])).toEqual({
      action: 'ask',
      kinds: ['camera', 'microphone']
    })
  })

  test('location, notifications and clipboard reads are asked', () => {
    expect(policyFor('geolocation')).toEqual({ action: 'ask', kinds: ['location'] })
    expect(policyFor('notifications')).toEqual({ action: 'ask', kinds: ['notifications'] })
    expect(policyFor('clipboard-read')).toEqual({ action: 'ask', kinds: ['clipboard-read'] })
  })

  test('everything else is denied', () => {
    for (const permission of [
      'openExternal',
      'midi',
      'midiSysex',
      'pointerLock',
      'keyboardLock',
      'mediaKeySystem',
      'idle-detection',
      'window-management',
      'storage-access',
      'fileSystem',
      'display-capture',
      'unknown',
      'something-new'
    ]) {
      expect(policyFor(permission)).toEqual({ action: 'deny' })
    }
  })
})

describe('checkFor', () => {
  test('maps checks to the same decisions', () => {
    expect(checkFor('fullscreen')).toBe('allow')
    expect(checkFor('media', 'video')).toBe('camera')
    expect(checkFor('media', 'audio')).toBe('microphone')
    expect(checkFor('media', 'unknown')).toBe('deny')
    expect(checkFor('notifications')).toBe('notifications')
    expect(checkFor('hid')).toBe('deny')
    expect(checkFor('usb')).toBe('deny')
    expect(checkFor('serial')).toBe('deny')
    expect(checkFor('deprecated-sync-clipboard-read')).toBe('deny')
  })
})

describe('permissionOrigin', () => {
  test('only web pages can hold permissions', () => {
    expect(permissionOrigin('https://chatgpt.com/c/123?x=1')).toBe('https://chatgpt.com')
    expect(permissionOrigin('http://localhost:3000/')).toBe('http://localhost:3000')
    expect(permissionOrigin('nebula://home/')).toBeNull()
    expect(permissionOrigin('file:///C:/x.html')).toBeNull()
    expect(permissionOrigin('')).toBeNull()
  })
})

describe('describeRequest', () => {
  test('reads like a sentence', () => {
    expect(describeRequest('chatgpt.com', ['microphone'])).toBe(
      'chatgpt.com wants to use your microphone'
    )
    expect(describeRequest('meet.google.com', ['camera', 'microphone'])).toBe(
      'meet.google.com wants to use your camera and microphone'
    )
    expect(describeRequest('maps.example', ['location'])).toBe(
      'maps.example wants to know your location'
    )
  })
})

describe('PermissionMemory', () => {
  const site = 'https://chatgpt.com'

  test('asks until the user answers, then remembers', () => {
    const memory = new PermissionMemory()
    expect(memory.decide(site, ['microphone'])).toBeUndefined()
    memory.remember(site, ['microphone'], true)
    expect(memory.decide(site, ['microphone'])).toBe(true)
    expect(memory.decide('https://other.example', ['microphone'])).toBeUndefined()
  })

  test('a block wins over an allow; partial answers still ask', () => {
    const memory = new PermissionMemory()
    memory.remember(site, ['camera'], true)
    expect(memory.decide(site, ['camera', 'microphone'])).toBeUndefined()
    expect(memory.unanswered(site, ['camera', 'microphone'])).toEqual(['microphone'])
    memory.remember(site, ['microphone'], false)
    expect(memory.decide(site, ['camera', 'microphone'])).toBe(false)
    expect(memory.decide(site, ['camera'])).toBe(true)
  })
})
