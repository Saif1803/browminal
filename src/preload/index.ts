import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { GLASS_SWITCH, IpcChannel, type BrowserApi, type BrowserState } from '../shared/types'

// Only named, typed calls cross the bridge. ipcRenderer itself is never exposed.
const browser: BrowserApi = {
  platform: process.platform,
  glass: process.argv.includes(GLASS_SWITCH),
  navigate: (input) => ipcRenderer.invoke(IpcChannel.Navigate, input),
  back: () => ipcRenderer.invoke(IpcChannel.Back),
  forward: () => ipcRenderer.invoke(IpcChannel.Forward),
  reload: () => ipcRenderer.invoke(IpcChannel.Reload),
  stop: () => ipcRenderer.invoke(IpcChannel.Stop),
  home: () => ipcRenderer.invoke(IpcChannel.Home),
  newTab: () => ipcRenderer.invoke(IpcChannel.NewTab),
  closeTab: (id) => ipcRenderer.invoke(IpcChannel.CloseTab, id),
  activateTab: (id) => ipcRenderer.invoke(IpcChannel.ActivateTab, id),
  reopenClosedTab: () => ipcRenderer.invoke(IpcChannel.ReopenClosedTab),
  toggleMute: (id) => ipcRenderer.invoke(IpcChannel.ToggleMute, id),
  resetZoom: () => ipcRenderer.invoke(IpcChannel.ResetZoom),
  find: (query) => ipcRenderer.invoke(IpcChannel.Find, query),
  findNext: (forward) => ipcRenderer.invoke(IpcChannel.FindNext, forward),
  closeFind: () => ipcRenderer.invoke(IpcChannel.CloseFind),
  showDownloadsMenu: (x, y) => ipcRenderer.invoke(IpcChannel.ShowDownloadsMenu, x, y),
  toggleBookmark: () => ipcRenderer.invoke(IpcChannel.ToggleBookmark),
  openBookmark: (id, disposition) => ipcRenderer.invoke(IpcChannel.OpenBookmark, id, disposition),
  showBookmarkMenu: (id, x, y) => ipcRenderer.invoke(IpcChannel.ShowBookmarkMenu, id, x, y),
  showBookmarksOverflow: (from, x, y) =>
    ipcRenderer.invoke(IpcChannel.ShowBookmarksOverflow, from, x, y),
  showAdblockMenu: (x, y) => ipcRenderer.invoke(IpcChannel.ShowAdblockMenu, x, y),
  showAgentMenu: (x, y) => ipcRenderer.invoke(IpcChannel.ShowAgentMenu, x, y),
  stopAgent: (id) => ipcRenderer.invoke(IpcChannel.StopAgent, id),
  toggleTerminal: () => ipcRenderer.invoke(IpcChannel.ToggleTerminal),
  newTerminal: () => ipcRenderer.invoke(IpcChannel.NewTerminal),
  closeTerminal: (id) => ipcRenderer.invoke(IpcChannel.CloseTerminal, id),
  selectTerminal: (id) => ipcRenderer.invoke(IpcChannel.SelectTerminal, id),
  setTerminalHeight: (px) => ipcRenderer.invoke(IpcChannel.SetTerminalHeight, px),
  attachTerminal: (id) => ipcRenderer.invoke(IpcChannel.AttachTerminal, id),
  startAgentInTerminal: (id) => ipcRenderer.invoke(IpcChannel.StartAgentInTerminal, id),
  chooseTerminalFolder: () => ipcRenderer.invoke(IpcChannel.ChooseTerminalFolder),
  setChromeHeight: (px) => ipcRenderer.invoke(IpcChannel.SetChromeHeight, px),
  getState: () => ipcRenderer.invoke(IpcChannel.GetState),

  onState(callback) {
    const listener = (_event: IpcRendererEvent, state: BrowserState): void => callback(state)
    ipcRenderer.on(IpcChannel.State, listener)
    return () => ipcRenderer.removeListener(IpcChannel.State, listener)
  },

  onFocusAddressBar(callback) {
    const listener = (_event: IpcRendererEvent, tabId: unknown): void => {
      if (typeof tabId === 'number') callback(tabId)
    }
    ipcRenderer.on(IpcChannel.FocusAddressBar, listener)
    return () => ipcRenderer.removeListener(IpcChannel.FocusAddressBar, listener)
  },

  onFocusFind(callback) {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannel.FocusFind, listener)
    return () => ipcRenderer.removeListener(IpcChannel.FocusFind, listener)
  }
}

contextBridge.exposeInMainWorld('browser', browser)
