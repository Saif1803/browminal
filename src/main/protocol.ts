import { app, protocol } from 'electron'
import { readFile } from 'fs/promises'
import { basename, join } from 'path'
import { INTERNAL_SCHEME } from '../shared/url'
import { resolveInternalFile } from './internal-files'
import { GLASS_MATERIAL } from './theme'

// A page's glass.css (translucent palette) is served only when the window is see-through; the
// page links it unconditionally, so it never needs script or IPC to know.
const GLASS_STYLESHEET = 'glass.css'

// Internal pages are static: their own scripts/styles only, no network requests of their own.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Must run before app 'ready'. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true } }
  ])
}

/** Serves nebula:// pages from resources/pages. Call after app 'ready'. */
export function handleInternalProtocol(): void {
  const root = join(app.getAppPath(), 'resources', 'pages')

  protocol.handle(INTERNAL_SCHEME, async (request) => {
    const file = request.method === 'GET' ? resolveInternalFile(root, request.url) : null
    if (!file) return new Response('Not found', { status: 404 })
    try {
      const isGlassSheet = basename(file.path) === GLASS_STYLESHEET
      const body = isGlassSheet && !GLASS_MATERIAL ? Buffer.alloc(0) : await readFile(file.path)
      return new Response(new Uint8Array(body), {
        headers: { 'content-type': file.mimeType, 'content-security-policy': CSP }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
