/**
 * What emulate can change about a tab: the device (screen size, pixel ratio, touch, user agent),
 * the colour scheme, the network and the CPU's speed. Pure: the state, the presets and the label the address bar
 * shows while any of it is on. The CDP calls live with the tool.
 */

export interface Viewport {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
}

export interface DevicePreset extends Viewport {
  label: string
  userAgent: string
}

export const DEVICES = {
  'iphone-15': {
    label: 'iPhone 15',
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  },
  'pixel-8': {
    label: 'Pixel 8',
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/130.0.0.0 Mobile Safari/537.36'
  },
  'ipad-air': {
    label: 'iPad Air',
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  }
} as const satisfies Record<string, DevicePreset>

export type DeviceName = keyof typeof DEVICES
export const DEVICE_NAMES = Object.keys(DEVICES) as [DeviceName, ...DeviceName[]]

/** Network.emulateNetworkConditions parameters, as DevTools' own presets. */
export const NETWORKS = {
  offline: {
    label: 'offline',
    offline: true,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  },
  slow3g: {
    label: 'slow 3G',
    offline: false,
    latency: 2000,
    downloadThroughput: 50_000,
    uploadThroughput: 50_000
  },
  fast3g: {
    label: 'fast 3G',
    offline: false,
    latency: 562.5,
    downloadThroughput: 180_000,
    uploadThroughput: 84_375
  }
} as const

export type NetworkName = keyof typeof NETWORKS

/** CPU slowdowns, as DevTools offers them (Emulation.setCPUThrottlingRate); 1 is full speed. */
export const CPU_RATES = [1, 4, 6] as const
export type CpuRate = (typeof CPU_RATES)[number]

export interface Emulation {
  /** A preset's name, or null for a custom viewport (or none). */
  device: DeviceName | null
  viewport: Viewport | null
  userAgent: string | null
  colorScheme: 'light' | 'dark' | null
  network: NetworkName | null
  /** How many times slower the CPU runs, or null for full speed. */
  cpu: Exclude<CpuRate, 1> | null
}

export const NO_EMULATION: Emulation = {
  device: null,
  viewport: null,
  userAgent: null,
  colorScheme: null,
  network: null,
  cpu: null
}

/** One emulate call. Each field left out keeps what's on; "none" turns that part off. */
export interface EmulationChange {
  device?: DeviceName | 'none'
  viewport?: { width: number; height: number; deviceScaleFactor?: number; mobile?: boolean }
  colorScheme?: 'light' | 'dark' | 'none'
  network?: NetworkName | 'none'
  /** 4 or 6 times slower; 1 is full speed again. */
  cpu?: CpuRate
}

export function applyEmulationChange(current: Emulation, change: EmulationChange): Emulation {
  const next = { ...current }
  if (change.device === 'none') {
    next.device = null
    next.viewport = null
    next.userAgent = null
  } else if (change.device) {
    const { userAgent, width, height, deviceScaleFactor, mobile } = DEVICES[change.device]
    next.device = change.device
    next.viewport = { width, height, deviceScaleFactor, mobile }
    next.userAgent = userAgent
  }
  if (change.viewport) {
    next.device = null
    next.userAgent = null
    next.viewport = {
      width: change.viewport.width,
      height: change.viewport.height,
      deviceScaleFactor: change.viewport.deviceScaleFactor ?? 1,
      mobile: change.viewport.mobile ?? false
    }
  }
  if (change.colorScheme)
    next.colorScheme = change.colorScheme === 'none' ? null : change.colorScheme
  if (change.network) next.network = change.network === 'none' ? null : change.network
  if (change.cpu !== undefined) next.cpu = change.cpu === 1 ? null : change.cpu
  return next
}

/** "iPhone 15 · dark · offline · CPU 4× slower": what the address bar badge says; null when nothing is on. */
export function emulationLabel(emulation: Emulation): string | null {
  const parts: string[] = []
  if (emulation.device) parts.push(DEVICES[emulation.device].label)
  else if (emulation.viewport)
    parts.push(`${emulation.viewport.width}×${emulation.viewport.height}`)
  if (emulation.colorScheme) parts.push(emulation.colorScheme)
  if (emulation.network) parts.push(NETWORKS[emulation.network].label)
  if (emulation.cpu) parts.push(`CPU ${emulation.cpu}× slower`)
  return parts.length ? parts.join(' · ') : null
}
