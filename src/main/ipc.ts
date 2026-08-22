import { app, BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Comment, FavoriteItem, FilterResult, Settings, SettingsView } from './types'
import { getState, getSettings, toggleFavorite, updateSettings } from './store'
import { resolveLlmKey, runFilter } from './filter/pipeline'
import { setQueue, size as queueSize } from './queue'
import { scheduler } from './scheduler'
import { createSettingsWindow, getPetWindow, movePetBy, setPetClickThrough } from './windows'

// 所有 ipcMain 注册集中处；业务逻辑唯一与 renderer 通信的地方。

function loadComments(): Comment[] {
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
  const { llm, ...rest } = s
  return {
    ...rest,
    llmEnabled: llm.enabled,
    llmHasKey: !!resolveLlmKey(s)
  }
}

export function registerIpc(): void {
  ipcMain.handle('settings:load', (): SettingsView => toView(getSettings()))

  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>): SettingsView => {
    const next = updateSettings(patch)
    scheduler.restart() // 设置变更后按新参数立即生效
    // 通知桌宠窗口刷新名称/皮肤等外观
    const petWin = getPetWindow()
    if (petWin && !petWin.isDestroyed()) {
      petWin.webContents.send('settings:changed', toView(next))
    }
    return toView(next)
  })

  ipcMain.handle('filter:run', async (): Promise<FilterResult> => {
    const settings = getSettings()
    const outcome = await runFilter(loadComments(), settings)
    setQueue(outcome.tagged) // setQueue 内部已清空去重记录，整批可推送
    return { filtered: queueSize(), total: outcome.total, usedLlm: outcome.usedLlm }
  })

  ipcMain.handle('push:one', (): boolean => scheduler.pushOne())

  ipcMain.on('pet:click-through', (_e, enabled: boolean) => setPetClickThrough(enabled))

  ipcMain.on('pet:move', (_e, dx: number, dy: number) => movePetBy(dx, dy))

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

  ipcMain.on('comment:skip', () => {
    // 跳过当前气泡：桌宠侧仅关闭气泡，无需 main 逻辑；预留钩子。
  })

  ipcMain.on('settings:open', () => createSettingsWindow())

  ipcMain.on('settings:close-self', (e) => {
    // 关闭发起请求的设置窗口
    BrowserWindow.fromWebContents(e.sender)?.close()
  })
}
