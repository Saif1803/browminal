import { clipboard, Menu, type MenuItemConstructorOptions } from 'electron'
import { canInspect, claudeAddCommand, mcpConfigJson } from './agent-policy'
import type { MainWindow } from './window'

function describe(main: MainWindow): string {
  const { enabled, error, port } = main.agent.getState()
  if (!enabled) return 'Agents are off'
  if (error) return `Agents can’t connect: ${error}`
  if (port === null) return 'Starting…'
  return `Agents connect at 127.0.0.1:${port}`
}

/**
 * The agent button's menu: share the active tab, switch the bridge on/off, and how to connect
 * Claude Code or another agent. A placeholder until the design pass brings a panel.
 */
export function showAgentMenu(main: MainWindow, x: number, y: number): void {
  const { window, tabs, agent } = main
  if (window.isDestroyed()) return
  const tab = tabs.active
  const port = agent.port

  const template: MenuItemConstructorOptions[] = [
    { label: describe(main), enabled: false },
    { type: 'separator' },
    {
      label: 'Share this tab with agents',
      type: 'checkbox',
      checked: agent.isShared(tab.id),
      enabled: !agent.shareAll || !agent.enabled,
      accelerator: 'CmdOrCtrl+Shift+A',
      registerAccelerator: false,
      click: () => agent.toggleShared(tab.id)
    },
    {
      label: 'Pick an element for agents',
      enabled: canInspect(tab.webContents.getURL()),
      accelerator: 'CmdOrCtrl+Shift+X',
      registerAccelerator: false,
      click: () => void agent.togglePicking(tab.id)
    },
    {
      label: 'Share every tab',
      type: 'checkbox',
      checked: agent.shareAll,
      enabled: agent.enabled,
      click: () => agent.setShareAll(!agent.shareAll)
    },
    {
      label: 'Let agents connect',
      type: 'checkbox',
      checked: agent.enabled,
      click: () => agent.setEnabled(!agent.enabled)
    },
    { type: 'separator' },
    {
      label: 'Copy command for Claude Code',
      enabled: port !== null,
      click: () => port !== null && clipboard.writeText(claudeAddCommand(port, agent.token))
    },
    {
      label: 'Copy MCP config (JSON)',
      enabled: port !== null,
      click: () => port !== null && clipboard.writeText(mcpConfigJson(port, agent.token))
    },
    {
      label: 'New token (disconnects agents)',
      enabled: agent.enabled,
      click: () => agent.renewToken()
    }
  ]
  if (!canInspect(tab.webContents.getURL()) && !agent.isShared(tab.id)) {
    template.splice(2, 0, {
      label: 'Agents can open pages here, but not read Browminal’s own pages',
      enabled: false
    })
  }
  Menu.buildFromTemplate(template).popup({ window, x, y })
}

/**
 * The errors badge's menu: send the active tab's new errors to agents, or dismiss them.
 * A placeholder until the design pass.
 */
export function showErrorsMenu(main: MainWindow, x: number, y: number): void {
  const { window, tabs, agent } = main
  if (window.isDestroyed()) return
  const tabId = tabs.active.id
  const count = agent.errorsOf(tabId)
  if (count === 0) return
  Menu.buildFromTemplate([
    { label: `${count} new error${count === 1 ? '' : 's'} on this page`, enabled: false },
    { type: 'separator' },
    { label: 'Send to agent', click: () => void agent.sendErrors(tabId) },
    { label: 'Dismiss', click: () => agent.dismissErrors(tabId) }
  ]).popup({ window, x, y })
}
