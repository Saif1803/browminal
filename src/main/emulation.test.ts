import { expect, test } from 'bun:test'
import { applyEmulationChange, emulationLabel, NO_EMULATION } from './emulation'

test('a device sets the viewport and user agent; none clears them', () => {
  const phone = applyEmulationChange(NO_EMULATION, { device: 'iphone-15' })
  expect(phone.viewport).toEqual({ width: 393, height: 852, deviceScaleFactor: 3, mobile: true })
  expect(phone.userAgent).toContain('iPhone')
  expect(emulationLabel(phone)).toBe('iPhone 15')
  expect(applyEmulationChange(phone, { device: 'none' })).toEqual(NO_EMULATION)
})

test('a custom viewport replaces the device', () => {
  const phone = applyEmulationChange(NO_EMULATION, { device: 'pixel-8' })
  const custom = applyEmulationChange(phone, { viewport: { width: 1024, height: 768 } })
  expect(custom).toMatchObject({
    device: null,
    userAgent: null,
    viewport: { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }
  })
  expect(emulationLabel(custom)).toBe('1024×768')
})

test('changes add up; each part turns off on its own', () => {
  let state = applyEmulationChange(NO_EMULATION, { device: 'ipad-air', colorScheme: 'dark' })
  state = applyEmulationChange(state, { network: 'slow3g' })
  expect(emulationLabel(state)).toBe('iPad Air · dark · slow 3G')
  state = applyEmulationChange(state, { colorScheme: 'none', network: 'offline' })
  expect(emulationLabel(state)).toBe('iPad Air · offline')
  state = applyEmulationChange(state, { device: 'none', network: 'none' })
  expect(emulationLabel(state)).toBeNull()
})

test('the CPU slows down 4 or 6 times; 1 is full speed again', () => {
  let state = applyEmulationChange(NO_EMULATION, { cpu: 4, colorScheme: 'dark' })
  expect(state.cpu).toBe(4)
  expect(emulationLabel(state)).toBe('dark · CPU 4× slower')
  state = applyEmulationChange(state, { cpu: 6 })
  expect(emulationLabel(state)).toBe('dark · CPU 6× slower')
  state = applyEmulationChange(state, { device: 'pixel-8' })
  expect(state.cpu).toBe(6)
  state = applyEmulationChange(state, { cpu: 1, colorScheme: 'none', device: 'none' })
  expect(state).toEqual(NO_EMULATION)
})
