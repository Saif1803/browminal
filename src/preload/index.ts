import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type BrowserApi, type TabState } from '../shared/types'

// Only named, typed calls cross the bridge. ipcRenderer itself is never exposed.
const browser: BrowserApi = {
  platform: process.platform,
  navigate: (input) => ipcRenderer.invoke(IpcChannel.Navigate, input),
  back: () => ipcRenderer.invoke(IpcChannel.Back),
  forward: () => ipcRenderer.invoke(IpcChannel.Forward),
  reload: () => ipcRenderer.invoke(IpcChannel.Reload),
  stop: () => ipcRenderer.invoke(IpcChannel.Stop),
  getState: () => ipcRenderer.invoke(IpcChannel.GetState),

  onTabState(callback) {
    const listener = (_event: IpcRendererEvent, state: TabState): void => callback(state)
    ipcRenderer.on(IpcChannel.TabState, listener)
    return () => ipcRenderer.removeListener(IpcChannel.TabState, listener)
  },

  onFocusAddressBar(callback) {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannel.FocusAddressBar, listener)
    return () => ipcRenderer.removeListener(IpcChannel.FocusAddressBar, listener)
  }
}

contextBridge.exposeInMainWorld('browser', browser)
