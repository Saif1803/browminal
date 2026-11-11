/** Permissions the user is asked about, one site at a time. */
export type PermissionKind =
  'camera' | 'microphone' | 'location' | 'notifications' | 'clipboard-read'

export type Policy =
  { action: 'allow' } | { action: 'deny' } | { action: 'ask'; kinds: PermissionKind[] }

const ALLOW: Policy = { action: 'allow' }
const DENY: Policy = { action: 'deny' }

// Harmless: a page going fullscreen (it can always leave with Esc) and writing plain text to the clipboard.
const SILENT = new Set(['fullscreen', 'clipboard-sanitized-write'])

// Screen sharing (getDisplayMedia; Electron 45+ names it apart from camera and microphone). Let
// through here: the screen picker (setDisplayMediaRequestHandler) asks every time.
const SCREEN_SHARE = 'display-capture'

const ASK: Record<string, PermissionKind> = {
  geolocation: 'location',
  notifications: 'notifications',
  'clipboard-read': 'clipboard-read'
}

/**
 * What to do with a permission request (Electron's names). Camera, microphone, location,
 * notifications and clipboard reading are asked; everything else (MIDI, USB, HID, serial,
 * opening other apps, pointer lock, …) is denied.
 */
export function policyFor(permission: string, mediaTypes: readonly string[] = []): Policy {
  if (SILENT.has(permission) || permission === SCREEN_SHARE) return ALLOW
  if (permission === 'media') {
    const kinds: PermissionKind[] = []
    if (mediaTypes.includes('video')) kinds.push('camera')
    if (mediaTypes.includes('audio')) kinds.push('microphone')
    return kinds.length > 0 ? { action: 'ask', kinds } : DENY
  }
  const kind = ASK[permission]
  return kind ? { action: 'ask', kinds: [kind] } : DENY
}

/**
 * A permission check (navigator.permissions, showing a notification, device labels): which
 * answer or remembered decision applies. Checks never prompt.
 */
export function checkFor(
  permission: string,
  mediaType?: string
): 'allow' | 'deny' | PermissionKind {
  if (SILENT.has(permission)) return 'allow'
  if (permission === 'media') {
    if (mediaType === 'video') return 'camera'
    if (mediaType === 'audio') return 'microphone'
    return 'deny'
  }
  return ASK[permission] ?? 'deny'
}

/** The origin a decision is remembered for, or null if the URL can't ask at all (only http(s) can). */
export function permissionOrigin(url: string): string | null {
  try {
    const { protocol, origin } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? origin : null
  } catch {
    return null
  }
}

const PHRASES: Record<PermissionKind, string> = {
  camera: 'use your camera',
  microphone: 'use your microphone',
  location: 'know your location',
  notifications: 'show notifications',
  'clipboard-read': 'see text and images copied to the clipboard'
}

/** "wants to use your camera and microphone": what a site asks for, after its name. */
export function describeWants(kinds: readonly PermissionKind[]): string {
  const wants =
    kinds.includes('camera') && kinds.includes('microphone')
      ? 'use your camera and microphone'
      : kinds.map((kind) => PHRASES[kind]).join(' and ')
  return `wants to ${wants}`
}

/** Decisions per site, kept in memory only: they last until the browser closes. */
export class PermissionMemory {
  private readonly sites = new Map<string, Map<PermissionKind, boolean>>()

  get(origin: string, kind: PermissionKind): boolean | undefined {
    return this.sites.get(origin)?.get(kind)
  }

  /** False if any kind was blocked, true if all were allowed, undefined if the user must be asked. */
  decide(origin: string, kinds: readonly PermissionKind[]): boolean | undefined {
    const known = kinds.map((kind) => this.get(origin, kind))
    if (known.includes(false)) return false
    return known.every((allowed) => allowed === true) ? true : undefined
  }

  /** The kinds the user hasn't answered yet for this site. */
  unanswered(origin: string, kinds: readonly PermissionKind[]): PermissionKind[] {
    return kinds.filter((kind) => this.get(origin, kind) === undefined)
  }

  remember(origin: string, kinds: readonly PermissionKind[], allowed: boolean): void {
    const site = this.sites.get(origin) ?? new Map<PermissionKind, boolean>()
    for (const kind of kinds) site.set(kind, allowed)
    this.sites.set(origin, site)
  }
}
