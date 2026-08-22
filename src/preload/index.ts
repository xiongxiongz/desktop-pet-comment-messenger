import { contextBridge, ipcRenderer } from 'electron'
import type { FavoriteItem, FilterResult, PushPayload, Settings, SettingsView } from '../main/types'

// window.api 唯一暴露面。key 等敏感信息只在 main，此处不暴露。

const api = {
  // ---- 设置侧 ----
  loadSettings: (): Promise<SettingsView> => ipcRenderer.invoke('settings:load'),
  saveSettings: (patch: Partial<Settings>): Promise<SettingsView> =>
    ipcRenderer.invoke('settings:save', patch),
  runFilterBatch: (): Promise<FilterResult> => ipcRenderer.invoke('filter:run'),
  requestOnePush: (): Promise<boolean> => ipcRenderer.invoke('push:one'),
  listFavorites: (): Promise<FavoriteItem[]> => ipcRenderer.invoke('favorites:list'),
  closeSettings: (): void => ipcRenderer.send('settings:close-self'),

  // ---- 桌宠侧 ----
  openSettings: (): void => ipcRenderer.send('settings:open'),
  onShowComment: (cb: (payload: PushPayload) => void): void => {
    ipcRenderer.removeAllListeners('comment:show')
    ipcRenderer.on('comment:show', (_e, payload: PushPayload) => cb(payload))
  },
  onSettingsChanged: (cb: (view: SettingsView) => void): void => {
    ipcRenderer.removeAllListeners('settings:changed')
    ipcRenderer.on('settings:changed', (_e, view: SettingsView) => cb(view))
  },
  skipComment: (): void => ipcRenderer.send('comment:skip'),
  favoriteComment: (id: string): Promise<boolean> => ipcRenderer.invoke('comment:favorite', id),
  setClickThrough: (enabled: boolean): void => ipcRenderer.send('pet:click-through', enabled),
  movePet: (dx: number, dy: number): void => ipcRenderer.send('pet:move', dx, dy)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
