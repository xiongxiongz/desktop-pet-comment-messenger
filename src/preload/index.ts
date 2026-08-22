import { contextBridge, ipcRenderer } from 'electron'
import type { CandidateSkinView, CustomSkinShape,
  FavoriteItem,
  FilterResult,
  PushOneResult,
  PushPayload,
  Settings,
  SettingsView, SkinPlacement
} from '../main/types'

// window.api 唯一暴露面。key 等敏感信息只在 main，此处不暴露。

const api = {
  // ---- 设置侧 ----
  loadSettings: (): Promise<SettingsView> => ipcRenderer.invoke('settings:load'),
  saveSettings: (patch: Partial<Settings>): Promise<SettingsView> =>
    ipcRenderer.invoke('settings:save', patch),
  chooseCustomSkinCandidate: (): Promise<CandidateSkinView | null> => ipcRenderer.invoke('skin:choose-custom-candidate'),
  confirmCustomSkin: (payload: { name: string; folderId?: string; shape?: CustomSkinShape; placement: Partial<SkinPlacement> }): Promise<SettingsView | null> =>
    ipcRenderer.invoke('skin:confirm-custom', payload),
  discardCustomSkinCandidate: (): Promise<void> => ipcRenderer.invoke('skin:discard-custom-candidate'),
  selectCustomSkin: (id: string): Promise<SettingsView | null> => ipcRenderer.invoke('skin:select', id),
  renameCustomSkin: (id: string, name: string): Promise<SettingsView | null> => ipcRenderer.invoke('skin:rename', id, name),
  setCustomSkinShape: (id: string, shape: CustomSkinShape): Promise<SettingsView | null> => ipcRenderer.invoke('skin:shape', id, shape),
  deleteCustomSkin: (id: string): Promise<SettingsView | null> => ipcRenderer.invoke('skin:delete', id),
  createCustomSkinFolder: (name: string): Promise<SettingsView | null> => ipcRenderer.invoke('skin:folder-create', name),
  renameCustomSkinFolder: (id: string, name: string): Promise<SettingsView | null> => ipcRenderer.invoke('skin:folder-rename', id, name),
  deleteCustomSkinFolder: (id: string): Promise<SettingsView | null> => ipcRenderer.invoke('skin:folder-delete', id),
  moveCustomSkin: (skinId: string, folderId: string): Promise<SettingsView | null> => ipcRenderer.invoke('skin:move', skinId, folderId),
  runFilterBatch: (): Promise<FilterResult> => ipcRenderer.invoke('filter:run'),
  requestOnePush: (): Promise<PushOneResult> => ipcRenderer.invoke('push:one'),
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
  beginPetDrag: (cursorX: number, cursorY: number): void => ipcRenderer.send('pet:drag-start', cursorX, cursorY),
  movePetToCursor: (cursorX: number, cursorY: number): void => ipcRenderer.send('pet:drag-move', cursorX, cursorY),
  endPetDrag: (): void => ipcRenderer.send('pet:drag-end'),
  showPetContextMenu: (): void => ipcRenderer.send('pet:context-menu')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
