import { extname, join, normalize, sep } from 'path'

/** Internal pages that may be served, keyed by URL host: nebula://<host>/ */
const PAGES = new Set(['home', 'error'])

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

export interface InternalFile {
  path: string
  mimeType: string
}

/**
 * Maps a nebula:// URL to a file under `root/<page>/`, or null if it isn't allowed.
 * Only known pages and known file types are served, and paths can't escape the page folder.
 */
export function resolveInternalFile(root: string, requestUrl: string): InternalFile | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (!PAGES.has(url.hostname)) return null

  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  // Backslashes are separators on Windows only; reject them so behaviour is the same everywhere.
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  if (pathname === '/' || pathname === '') pathname = '/index.html'

  const pageDir = join(root, url.hostname)
  const path = normalize(join(pageDir, pathname))
  if (!path.startsWith(pageDir + sep)) return null

  const mimeType = MIME_TYPES[extname(path).toLowerCase()]
  return mimeType ? { path, mimeType } : null
}
