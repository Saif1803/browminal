const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, i) => bytes[offset + i] === byte)

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))

/**
 * Detects an image format from its first bytes and returns its MIME type, or null if
 * it isn't one we show. Favicons are checked this way instead of trusting Content-Type.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp'
  if (startsWith(bytes, ascii('BM'))) return 'image/bmp'

  // SVG is text: skip a BOM (TextDecoder drops it) and whitespace, then allow an XML prolog, comments or a doctype first.
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart()
  if (/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE svg[^>]*>\s*)*<svg[\s>]/i.test(head)) {
    return 'image/svg+xml'
  }
  return null
}
