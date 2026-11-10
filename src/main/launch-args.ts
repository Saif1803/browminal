/**
 * Pure: the page a launch of Browminal asks for on its command line (`browminal https://…`), for
 * the first launch or one handed over to the running instance. Only an absolute http(s) URL counts
 * (resolveInput's http(s) rule); switches, paths, other schemes and search text are ignored, so a
 * command line can never load `browminal://`, `file:` or anything that isn't a web page.
 */
export function launchUrl(argv: readonly string[]): string | null {
  // Electron and Chromium put their switches and the app's path first; the URL, if any, is last.
  for (let i = argv.length - 1; i >= 1; i--) {
    const arg = argv[i]
    if (arg.startsWith('-')) continue
    if (!/^https?:\/\//i.test(arg)) continue
    try {
      const url = new URL(arg)
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return url.href
    } catch {
      // Not a URL: ignored.
    }
  }
  return null
}
