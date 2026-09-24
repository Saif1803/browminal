import { app, protocol } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { INTERNAL_SCHEME } from '../shared/url'
import { resolveInternalFile } from './internal-files'

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
      const body = await readFile(file.path)
      return new Response(new Uint8Array(body), {
        headers: { 'content-type': file.mimeType, 'content-security-policy': CSP }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
