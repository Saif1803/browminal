import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { resolveInternalFile } from './internal-files'

const root = join('/app', 'resources', 'pages')

describe('resolveInternalFile', () => {
  test('serves the home page and its assets', () => {
    expect(resolveInternalFile(root, 'nebula://home/')).toEqual({
      path: join(root, 'home', 'index.html'),
      mimeType: 'text/html; charset=utf-8'
    })
    expect(resolveInternalFile(root, 'nebula://home/home.css')?.path).toBe(
      join(root, 'home', 'home.css')
    )
  })

  test('serves the error page', () => {
    expect(
      resolveInternalFile(root, 'nebula://error/?code=X&url=https%3A%2F%2Fa.example%2F')
    ).toEqual({
      path: join(root, 'error', 'index.html'),
      mimeType: 'text/html; charset=utf-8'
    })
  })

  test('rejects unknown pages', () => {
    expect(resolveInternalFile(root, 'nebula://settings/')).toBeNull()
    expect(resolveInternalFile(root, 'not a url')).toBeNull()
  })

  test('rejects path traversal', () => {
    expect(resolveInternalFile(root, 'nebula://home/../../package.json')).toBeNull()
    // Encoded dot segments are collapsed by the URL parser, so this stays inside home/.
    expect(resolveInternalFile(root, 'nebula://home/%2e%2e/%2e%2e/secret.js')?.path).toBe(
      join(root, 'home', 'secret.js')
    )
    expect(resolveInternalFile(root, 'nebula://home/..%5c..%5csecret.js')).toBeNull()
    expect(resolveInternalFile(root, 'nebula://home/x%00.html')).toBeNull()
  })

  test('rejects unknown file types', () => {
    expect(resolveInternalFile(root, 'nebula://home/data.json')).toBeNull()
    expect(resolveInternalFile(root, 'nebula://home/run.exe')).toBeNull()
  })
})
