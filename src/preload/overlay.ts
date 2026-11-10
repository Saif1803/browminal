import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  OverlayChannel,
  type BackdropLayer,
  type OverlayApi,
  type OverlayState
} from '../shared/overlay'

// The overlay view's only way to main: one named message per action. ipcRenderer stays here.
const overlay: OverlayApi = {
  platform: process.platform,
  ready: () => ipcRenderer.send(OverlayChannel.Ready),
  setHeight: (px) => ipcRenderer.send(OverlayChannel.SetHeight, px),
  close: () => ipcRenderer.send(OverlayChannel.Close),
  setAgentsEnabled: (enabled) => ipcRenderer.send(OverlayChannel.SetAgentsEnabled, enabled),
  setTabShared: (shared) => ipcRenderer.send(OverlayChannel.SetTabShared, shared),
  setShareAll: (shareAll) => ipcRenderer.send(OverlayChannel.SetShareAll, shareAll),
  pickElement: () => ipcRenderer.send(OverlayChannel.PickElement),
  copyConnect: (what) => ipcRenderer.send(OverlayChannel.CopyConnect, what),
  renewToken: () => ipcRenderer.send(OverlayChannel.RenewToken),
  retryBridge: () => ipcRenderer.send(OverlayChannel.RetryBridge),
  stopAgent: () => ipcRenderer.send(OverlayChannel.StopAgent),
  sendErrors: () => ipcRenderer.send(OverlayChannel.SendErrors),
  dismissErrors: () => ipcRenderer.send(OverlayChannel.DismissErrors),
  answer: (id, confirmed) => ipcRenderer.send(OverlayChannel.Answer, id, confirmed),
  choose: (id, ctrl, shift) => ipcRenderer.send(OverlayChannel.Choose, id, ctrl, shift),

  onState(callback) {
    const listener = (_event: IpcRendererEvent, state: OverlayState): void => callback(state)
    ipcRenderer.on(OverlayChannel.State, listener)
    return () => ipcRenderer.removeListener(OverlayChannel.State, listener)
  },

  onBackdrop(callback) {
    const listener = (_event: IpcRendererEvent, layers: BackdropLayer[]): void => callback(layers)
    ipcRenderer.on(OverlayChannel.Backdrop, listener)
    return () => ipcRenderer.removeListener(OverlayChannel.Backdrop, listener)
  }
}

contextBridge.exposeInMainWorld('overlay', overlay)
