/**
 * Removes the "Electron/x" and "<app>/x" tokens Electron adds to Chrome's user agent.
 * Google sign-in (used by ChatGPT and Claude) refuses browsers that look embedded.
 */
export function cleanUserAgent(userAgent: string, appName: string): string {
  const names = ['Electron', appName].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const tokens = new RegExp(`(^|\\s)(${names.join('|')})/\\S+`, 'gi')
  return userAgent.replace(tokens, '').replace(/\s+/g, ' ').trim()
}
