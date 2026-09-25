const FALLBACK_NAME = 'download'
// Leaves room for " (99)" and a temp suffix under common 255-character file-name limits.
const MAX_NAME_LENGTH = 200
// After "name (9999)", give up counting and use a timestamp.
const MAX_NUMBER = 9999
// Kept together when a number is added: "archive (1).tar.gz", not "archive.tar (1).gz".
const COMPOUND_EXTENSIONS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst']
// Names Windows reserves for devices, with or without an extension.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/** Splits "report.pdf" into ["report", ".pdf"]. Dotfiles like ".env" have no extension. */
function splitExtension(name: string): [string, string] {
  const lower = name.toLowerCase()
  const compound = COMPOUND_EXTENSIONS.find((ext) => lower.endsWith(ext) && lower !== ext)
  if (compound) return [name.slice(0, -compound.length), name.slice(-compound.length)]
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return [name, '']
  return [name.slice(0, dot), name.slice(dot)]
}

/**
 * A file name that's safe to create in the Downloads folder on any platform: no folders,
 * no characters Windows rejects, no device names, not hidden, and not too long.
 */
export function safeFilename(suggested: string): string {
  let name = suggested
    // Only the last part of anything that looks like a path.
    .split(/[/\\]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .trim()
    // Windows drops trailing dots and spaces; leading dots would hide the file.
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')

  if (RESERVED.test(name)) name = `_${name}`
  if (name.length > MAX_NAME_LENGTH) {
    const [base, ext] = splitExtension(name)
    name =
      ext.length < 20
        ? base.slice(0, MAX_NAME_LENGTH - ext.length) + ext
        : name.slice(0, MAX_NAME_LENGTH)
  }
  return name || FALLBACK_NAME
}

/**
 * `name`, or the first of "name (1).ext", "name (2).ext", … that isn't taken, like Chrome.
 * `isTaken` should cover files on disk and downloads still in progress.
 */
export function uniqueFilename(name: string, isTaken: (name: string) => boolean): string {
  if (!isTaken(name)) return name
  const [base, ext] = splitExtension(name)
  for (let n = 1; n <= MAX_NUMBER; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!isTaken(candidate)) return candidate
  }
  return `${base} (${Date.now()})${ext}`
}
