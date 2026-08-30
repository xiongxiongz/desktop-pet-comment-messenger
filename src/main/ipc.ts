import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AiReactionProgress,
  Comment, CustomSkinShape,
  FavoriteItem,
  FilterResult,
  PushOneResult,
  Settings,
  SettingsView, SkinPlacement
} from './types'
import { getState, getSettings, toggleFavorite, updateSettings } from './store'
import { enrichReactions, resolveLlmKey, runFilter } from './filter/pipeline'
import { llmTestKey } from './filter/llmClassifier'
import { setQueue, size as queueSize } from './queue'
import { loadCollectedComments } from './collection'
import { scheduler } from './scheduler'
import { chooseAiReference, deleteAiReference, getReactionUrl, getReferenceUrl, prefetchReactionImages } from './aiReaction'
import { listLlmOperationLogs } from './llmCache'
import { beginPetDrag, createSettingsWindow, endPetDrag, getPetWindow, movePetToCursor, setPetClickThrough, showPetContextMenu } from './windows'
import {
  chooseCustomSkinCandidate,
  commitCustomSkinCandidate,
  discardCustomSkinCandidate,
  getCustomSkinPath,
  getLibrarySkinUrl
} from './customSkin'

// 所有 ipcMain 注册集中处；业务逻辑唯一与 renderer 通信的地方。

function loadComments(): Comment[] {
  // 优先读采集快照（打包后随 dmg 分发的 collections.sqlite；开发期 local-data/collections.sqlite）
  const collected = loadCollectedComments()
  if (collected.length) return collected
  // 回退：未采集时仍用示例数据
  const path = app.isPackaged
    ? join(process.resourcesPath, 'comments.json')
    : join(__dirname, '../../src/main/data/comments.json')
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Comment[]
  } catch (err) {
    console.error('[ipc] 加载 comments.json 失败:', path, err)
    return []
  }
}

/** 把内部 Settings 转成暴露给 renderer 的安全视图（llm 只给布尔） */
function toView(s: Settings): SettingsView {
  const { llm, aiReaction: _aiReaction, customSkinFile: _customSkinFile, customSkins, customSkinFolders, ...rest } = s
  const selected = customSkins.find((item) => item.id === s.selectedCustomSkinId)
  const folderIds = new Set(customSkinFolders.map((folder) => folder.id))
  return {
    ...rest,
    customSkins: customSkins
      .map((item) => {
        const url = getLibrarySkinUrl(item.id, item)
        return url ? { id: item.id, name: item.name, folderId: folderIds.has(item.folderId) ? item.folderId : '', shape: item.shape, animated: item.animated, url } : null
      })
      .filter((item): item is NonNullable<typeof item> => !!item),
    customSkinFolders: customSkinFolders.map((folder) => ({ id: folder.id, name: folder.name })),
    llmEnabled: llm.enabled,
    llmHasKey: !!resolveLlmKey(s),
    customSkinUrl: selected ? getLibrarySkinUrl(selected.id, selected) : null,
    aiReactionEnabled: s.aiReaction.enabled,
    aiReactionHasReference: !!getReferenceUrl(s),
    aiReactionReferenceUrl: getReferenceUrl(s),
    aiReactionDemoMode: s.aiReaction.demoMode
  }
}

function boundedPlacement(placement: Partial<SkinPlacement>): SkinPlacement {
  return {
    scale: Math.max(50, Math.min(200, Number(placement.scale) || 100)),
    offsetX: Math.max(-80, Math.min(80, Number(placement.offsetX) || 0)),
    offsetY: Math.max(-80, Math.min(80, Number(placement.offsetY) || 0)),
    scaleMode: placement.scaleMode === 'frame' ? 'frame' : 'content'
  }
}

function notifyPetSettingsChanged(next: Settings): void {
  const petWin = getPetWindow()
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('settings:changed', toView(next))
  }
}

function notifyAiReactionProgress(progress: AiReactionProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('ai-reaction:progress', progress)
  }
}

export function registerIpc(): void {
  ipcMain.handle('settings:load', (): SettingsView => toView(getSettings()))

  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>): SettingsView => {
    const next = updateSettings(patch)
    scheduler.restart() // 设置变更后按新参数立即生效
    notifyPetSettingsChanged(next)
    return toView(next)
  })

  ipcMain.handle('skin:choose-custom-candidate', async (e) => {
    const settingsWindow = BrowserWindow.fromWebContents(e.sender)
    if (!settingsWindow) return null
    return chooseCustomSkinCandidate(settingsWindow)
  })

  ipcMain.handle('ai-reaction:choose-reference', async (e): Promise<SettingsView | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return null
    const file = await chooseAiReference(win)
    if (file) {
      const next = updateSettings({ aiReaction: { ...getSettings().aiReaction, referenceFile: file } })
      notifyPetSettingsChanged(next)
      return toView(next)
    }
    return toView(getSettings())
  })
  ipcMain.handle('ai-reaction:delete-reference', (): SettingsView => {
    deleteAiReference()
    const next = updateSettings({ aiReaction: { ...getSettings().aiReaction, referenceFile: '' } })
    notifyPetSettingsChanged(next)
    return toView(next)
  })

  ipcMain.handle(
    'skin:confirm-custom',
    (_e, payload: { name: string; folderId?: string; shape?: CustomSkinShape; placement: Partial<SkinPlacement> }): SettingsView | null => {
      const item = commitCustomSkinCandidate(payload?.name ?? '')
      if (!item) return null
      const settings = getSettings()
      const requestedFolderId = typeof payload?.folderId === 'string' ? payload.folderId : ''
      const targetFolder = settings.customSkinFolders.find((folder) => folder.id === requestedFolderId)
      const createdFolder = targetFolder
        ? null
        : { id: `folder-${randomUUID()}`, name: item.name, createdAt: new Date().toISOString() }
      const shape: CustomSkinShape = payload?.shape === 'circle' ? 'circle' : 'square'
      const itemWithFolder = { ...item, folderId: targetFolder?.id ?? createdFolder!.id, shape }
      const placement = boundedPlacement(payload.placement ?? {})
      const next = updateSettings({
        skin: 'custom',
        customSkinFile: itemWithFolder.fileName,
        selectedCustomSkinId: itemWithFolder.id,
        customSkins: [...settings.customSkins, itemWithFolder],
        customSkinFolders: createdFolder ? [...settings.customSkinFolders, createdFolder] : settings.customSkinFolders,
        customSkinPlacements: { ...settings.customSkinPlacements, [itemWithFolder.id]: placement },
        customSkinScale: placement.scale,
        customSkinOffsetX: placement.offsetX,
        customSkinOffsetY: placement.offsetY,
        skinPlacements: { ...settings.skinPlacements, custom: placement }
      })
      notifyPetSettingsChanged(next)
      return toView(next)
    }
  )

  ipcMain.handle('skin:discard-custom-candidate', (): void => discardCustomSkinCandidate())

  ipcMain.handle('skin:select', (_e, id: string): SettingsView | null => {
    const settings = getSettings()
    const item = settings.customSkins.find((skin) => skin.id === id)
    if (!item) return null
    const placement = settings.customSkinPlacements[id] ?? { scale: 100, offsetX: 0, offsetY: 0 }
    const next = updateSettings({
      skin: 'custom',
      customSkinFile: item.fileName,
      selectedCustomSkinId: id,
      customSkinScale: placement.scale,
      customSkinOffsetX: placement.offsetX,
      customSkinOffsetY: placement.offsetY,
      skinPlacements: { ...settings.skinPlacements, custom: placement }
    })
    notifyPetSettingsChanged(next)
    return toView(next)
  })

  ipcMain.handle('skin:rename', (_e, id: string, name: string): SettingsView | null => {
    const settings = getSettings()
    const trimmedName = typeof name === 'string' ? name.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 24) : ''
    if (!trimmedName || !settings.customSkins.some((skin) => skin.id === id)) return null
    const next = updateSettings({ customSkins: settings.customSkins.map((skin) => (skin.id === id ? { ...skin, name: trimmedName } : skin)) })
    return toView(next)
  })

  ipcMain.handle('skin:shape', (_e, id: string, shape: CustomSkinShape): SettingsView | null => {
    const settings = getSettings()
    if (!settings.customSkins.some((skin) => skin.id === id) || (shape !== 'square' && shape !== 'circle')) return null
    const next = updateSettings({ customSkins: settings.customSkins.map((skin) => (skin.id === id ? { ...skin, shape } : skin)) })
    notifyPetSettingsChanged(next)
    return toView(next)
  })

  ipcMain.handle('skin:delete', (_e, id: string): SettingsView | null => {
    const settings = getSettings()
    const deleted = settings.customSkins.find((skin) => skin.id === id)
    if (!deleted) return null
    const remaining = settings.customSkins.filter((skin) => skin.id !== id)
    const { [id]: _deletedPlacement, ...customSkinPlacements } = settings.customSkinPlacements
    const nextSelected = settings.selectedCustomSkinId === id ? remaining[0]?.id ?? '' : settings.selectedCustomSkinId
    const nextItem = remaining.find((skin) => skin.id === nextSelected)
    const nextPlacement = nextSelected ? customSkinPlacements[nextSelected] ?? { scale: 100, offsetX: 0, offsetY: 0 } : settings.skinPlacements.custom
    const next = updateSettings({
      skin: remaining.length === 0 && settings.skin === 'custom' ? 'cat' : settings.skin,
      customSkins: remaining,
      selectedCustomSkinId: nextSelected,
      customSkinPlacements,
      customSkinFile: nextItem?.fileName ?? '',
      skinPlacements: { ...settings.skinPlacements, custom: nextPlacement }
    })
    const path = getCustomSkinPath(deleted.fileName)
    if (path) {
      try {
        unlinkSync(path)
      } catch (err) {
        console.warn('[skin] 删除皮肤文件失败:', err)
      }
    }
    notifyPetSettingsChanged(next)
    return toView(next)
  })

  ipcMain.handle('skin:folder-create', (_e, name: string): SettingsView | null => {
    const settings = getSettings()
    const trimmedName = typeof name === 'string' ? name.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 24) : ''
    if (!trimmedName) return null
    const next = updateSettings({
      customSkinFolders: [...settings.customSkinFolders, { id: `folder-${randomUUID()}`, name: trimmedName, createdAt: new Date().toISOString() }]
    })
    return toView(next)
  })

  ipcMain.handle('skin:folder-rename', (_e, id: string, name: string): SettingsView | null => {
    const settings = getSettings()
    const trimmedName = typeof name === 'string' ? name.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 24) : ''
    if (!trimmedName || !settings.customSkinFolders.some((folder) => folder.id === id)) return null
    return toView(updateSettings({
      customSkinFolders: settings.customSkinFolders.map((folder) => (folder.id === id ? { ...folder, name: trimmedName } : folder))
    }))
  })

  ipcMain.handle('skin:folder-delete', (_e, id: string): SettingsView | null => {
    const settings = getSettings()
    if (!settings.customSkinFolders.some((folder) => folder.id === id)) return null
    return toView(updateSettings({
      customSkinFolders: settings.customSkinFolders.filter((folder) => folder.id !== id),
      customSkins: settings.customSkins.map((skin) => (skin.folderId === id ? { ...skin, folderId: '' } : skin))
    }))
  })

  ipcMain.handle('skin:move', (_e, skinId: string, folderId: string): SettingsView | null => {
    const settings = getSettings()
    const folderExists = folderId === '' || settings.customSkinFolders.some((folder) => folder.id === folderId)
    if (!folderExists || !settings.customSkins.some((skin) => skin.id === skinId)) return null
    return toView(updateSettings({
      customSkins: settings.customSkins.map((skin) => (skin.id === skinId ? { ...skin, folderId } : skin))
    }))
  })

  ipcMain.handle('filter:run', async (): Promise<FilterResult> => {
    const settings = getSettings()
    const outcome = await runFilter(loadComments(), settings)
    setQueue(outcome.tagged) // setQueue 内部已清空去重记录，整批可推送
    if (settings.aiReaction.enabled && settings.aiReaction.referenceFile && resolveLlmKey(settings)) {
      const analysisTotal = Math.min(outcome.tagged.length, Math.max(1, settings.llm.topK))
      notifyAiReactionProgress({ phase: 'analyzing', completed: 0, total: analysisTotal, failed: 0 })
      void enrichReactions(outcome.tagged, settings)
        .then(() => prefetchReactionImages(outcome.tagged, settings, resolveLlmKey(settings), notifyAiReactionProgress))
        .then(() => notifyAiReactionProgress({ phase: 'complete', completed: 1, total: 1, failed: 0 }))
        .catch((err) => {
          console.warn('[ipc] AI reaction background task failed:', err)
          notifyAiReactionProgress({ phase: 'complete', completed: 0, total: 1, failed: 1 })
        })
    }
    return { filtered: queueSize(), total: outcome.total, usedLlm: outcome.usedLlm, llmError: outcome.llmError }
  })

  ipcMain.handle('llm:test-key', async (): Promise<{ ok: boolean; error?: string }> => {
    const settings = getSettings()
    const key = resolveLlmKey(settings)
    if (!key) return { ok: false, error: '未配置 key' }
    try {
      await llmTestKey(settings.llm, key)
      return { ok: true }
    } catch (err) {
      const status = (err as { status?: number } | null | undefined)?.status
      const message = err instanceof Error ? err.message : String(err)
      if (status === 401 || /invalid_api_key|incorrect api key|unauthorized/i.test(message)) {
        return { ok: false, error: 'API Key 无效' }
      }
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('ai-reaction:preheat-demo', async (): Promise<{ generated: number; candidates: number }> => {
    const settings = getSettings()
    const key = resolveLlmKey(settings)
    if (!settings.aiReaction.enabled || !getReferenceUrl(settings) || !key) {
      throw new Error('请先开启动作生成、设置 AI 动作参考图并配置大模型 Key')
    }
    const outcome = await runFilter(loadComments(), settings)
    setQueue(outcome.tagged)
    const candidates = outcome.tagged.length
    const before = outcome.tagged.filter((comment) => comment.reaction?.shouldGenerate).length
    const analysisTotal = Math.min(candidates, Math.max(1, settings.llm.topK))
    notifyAiReactionProgress({ phase: 'analyzing', completed: 0, total: analysisTotal, failed: 0 })
    await enrichReactions(outcome.tagged, settings)
    await prefetchReactionImages(outcome.tagged, settings, key, notifyAiReactionProgress)
    const generated = outcome.tagged.filter((comment) => !!getReactionUrl(comment, settings)).length
    if (before === 0 && generated === 0) notifyAiReactionProgress({ phase: 'complete', completed: 0, total: 1, failed: 0 })
    else notifyAiReactionProgress({ phase: 'complete', completed: generated, total: Math.max(1, generated), failed: 0 })
    return { generated, candidates }
  })

  ipcMain.handle('push:one', (): PushOneResult => scheduler.pushOne())

  ipcMain.on('pet:click-through', (_e, enabled: boolean) => setPetClickThrough(enabled))

  ipcMain.on('pet:drag-start', (_e, cursorX: number, cursorY: number) => beginPetDrag(cursorX, cursorY))

  ipcMain.on('pet:drag-move', (_e, cursorX: number, cursorY: number) => movePetToCursor(cursorX, cursorY))

  ipcMain.on('pet:drag-end', () => endPetDrag())

  ipcMain.on('pet:context-menu', () => showPetContextMenu())

  ipcMain.handle('comment:favorite', (_e, id: string): boolean => toggleFavorite(id))

  ipcMain.handle('favorites:list', (): FavoriteItem[] => {
    const favIds = getState().favorites
    if (favIds.length === 0) return []
    const byId = new Map(loadComments().map((c) => [c.id, c]))
    // 保持收藏时间顺序（favorites 数组的追加序）
    return favIds
      .map((id) => byId.get(id))
      .filter((c): c is Comment => !!c)
      .map((c) => ({
        id: c.id,
        author: c.author,
        text: c.text,
        videoTitle: c.videoTitle,
        likeCount: c.likeCount,
        kind: c.kind,
        tag: c.tag
      }))
  })

  ipcMain.handle('llm-logs:list', () => listLlmOperationLogs())

  ipcMain.on('comment:skip', () => {
    // 跳过当前气泡：桌宠侧仅关闭气泡，无需 main 逻辑；预留钩子。
  })

  ipcMain.on('settings:open', () => createSettingsWindow())

  ipcMain.on('settings:close-self', (e) => {
    // 关闭发起请求的设置窗口
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
}
