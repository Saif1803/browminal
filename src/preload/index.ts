import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type BrowserApi, type BrowserState } from '../shared/types'

// Only named, typed calls cross the bridge. ipcRenderer itself is never exposed.
const browser: BrowserApi = {
  platform: process.platform,
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
  setChromeHeight: (px) => ipcRenderer.invoke(IpcChannel.SetChromeHeight, px),
  getState: () => ipcRenderer.invoke(IpcChannel.GetState),

  onState(callback) {
    const listener = (_event: IpcRendererEvent, state: BrowserState): void => callback(state)
    ipcRenderer.on(IpcChannel.State, listener)
    return () => ipcRenderer.removeListener(IpcChannel.State, listener)
  },

  onFocusAddressBar(callback) {
    const listener = (): void => callback()
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
