import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { TerminalViewChannel, type TerminalViewApi } from '../shared/terminal-view'

// The terminal view's only way to main: terminal I/O and nothing else. ipcRenderer stays here.
const terminal: TerminalViewApi = {
  platform: process.platform,
  input: (id, data) => ipcRenderer.send(TerminalViewChannel.Input, id, data),
  resize: (id, cols, rows) => ipcRenderer.send(TerminalViewChannel.Resize, id, cols, rows),
  copy: (text) => ipcRenderer.send(TerminalViewChannel.Copy, text),
  openLink: (id, url) => ipcRenderer.send(TerminalViewChannel.OpenLink, id, url),
  ready: () => ipcRenderer.send(TerminalViewChannel.Ready),

  onSessions(callback) {
    const listener = (_event: IpcRendererEvent, sessions: unknown, activeId: unknown): void => {
      if (!Array.isArray(sessions)) return
      callback(
        sessions.filter(
          (s): s is { id: number; exited: boolean } =>
            typeof s?.id === 'number' && typeof s?.exited === 'boolean'
        ),
        typeof activeId === 'number' ? activeId : null
      )
    }
    ipcRenderer.on(TerminalViewChannel.Sessions, listener)
    return () => ipcRenderer.removeListener(TerminalViewChannel.Sessions, listener)
  },

  onOutput(callback) {
    const listener = (_event: IpcRendererEvent, id: unknown, data: unknown): void => {
      if (typeof id === 'number' && typeof data === 'string') callback(id, data)
    }
    ipcRenderer.on(TerminalViewChannel.Output, listener)
    return () => ipcRenderer.removeListener(TerminalViewChannel.Output, listener)
  },

  onFocus(callback) {
    const listener = (): void => callback()
    ipcRenderer.on(TerminalViewChannel.Focus, listener)
    return () => ipcRenderer.removeListener(TerminalViewChannel.Focus, listener)
  }
}

contextBridge.exposeInMainWorld('terminal', terminal)
