/** How the window's see-through background is made on this system, or null for a solid one. */
export type GlassMaterial = 'acrylic' | 'vibrancy' | null

// Windows 11 22H2 is the first build with system-drawn backdrop materials (backgroundMaterial).
const FIRST_ACRYLIC_BUILD = 22621

/** `release` is os.release(), e.g. "10.0.26200" on Windows. */
export function glassMaterial(platform: string, release: string): GlassMaterial {
  if (platform === 'darwin') return 'vibrancy'
  if (platform !== 'win32') return null
  const [major, , build] = release.split('.').map(Number)
  return major >= 10 && build >= FIRST_ACRYLIC_BUILD ? 'acrylic' : null
}
