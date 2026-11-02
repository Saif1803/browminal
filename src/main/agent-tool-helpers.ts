import type { WebContents } from 'electron'
import { z } from 'zod'
import { parseErrorPageUrl } from '../shared/url'
import { canInspect, type AgentTab } from './agent-policy'
import type { CdpSession } from './cdp'
import type { Tab } from './tabs'

const LOAD_TIMEOUT_MS = 30_000
/** The isolated world agent tools read pages in (the page's own scripts can't interfere). */
export const AGENT_WORLD_ID = 2003

/** What the tools need from the app (Agent implements it). */
export interface AgentContext {
  listTabs(): AgentTab[]
  /** The shared tab a tool acts on; throws a message for the agent when there isn't one. */
  tab(tabId: number | undefined): Tab
  cdp(tab: Tab): CdpSession
  /** Runs one tool's work on `tab`, showing the user that an agent is at work there. */
  run<T>(tab: Tab, work: () => Promise<T>): Promise<T>
  /** Opens a shared tab the agent may close again. */
  openTab(url: string, background: boolean): Tab
  /** Closes a tab the agent opened; throws for any other. */
  closeTab(tabId: number): void
  /** Brings a shared tab to the front and makes it the default for the next tools. */
  selectTab(tabId: number): Tab
}

export const text = (value: string): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: value }]
})

export const tabIdInput = z
  .number()
  .int()
  .optional()
  .describe('The tab to act on (from list_tabs). Defaults to the tab used last, or the active one.')

export function assertInspectable(tab: Tab): void {
  if (!canInspect(tab.webContents.getURL())) {
    throw new Error(
      `Tab ${tab.id} shows one of Nebula's own pages (${tab.url || 'the start page'}), which ` +
        'agents can’t read or script. Navigate it to a web page first.'
    )
  }
}

/** Resolves once the tab has stopped loading, or after `timeoutMs`. */
export function waitForLoad(webContents: WebContents, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      webContents.off('did-stop-loading', done)
      webContents.off('did-navigate-in-page', done)
      webContents.off('destroyed', done)
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)
    webContents.on('did-stop-loading', done)
    webContents.on('did-navigate-in-page', done)
    webContents.once('destroyed', done)
  })
}

/** Where a tab ended up after loading, as the agent reads it. */
export function describeLoad(tab: Tab): string {
  if (tab.webContents.isDestroyed()) return `Tab ${tab.id} was closed.`
  const failed = parseErrorPageUrl(tab.webContents.getURL())
  if (failed) return `[tab ${tab.id}] Failed to load ${failed.url}: ${failed.code}`
  const { title, url } = tab.getSummary()
  return `[tab ${tab.id}] ${title && title !== url ? `${title} — ` : ''}${url}`
}
