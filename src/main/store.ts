import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type CustomSkin, type CustomSkinFolder, type PersistedState, type Settings, type SkinPlacement } from './types'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

function defaultState(): PersistedState {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    favorites: []
  }
}

/** 深合并已存配置到默认值，容忍缺字段/旧版本 */
function mergeSettings(saved: Partial<Settings> | undefined): Settings {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!saved) return base
  // 将旧版仅支持自定义皮肤的调节值迁移到新版的独立皮肤配置中。
  const legacyCustomPlacement = {
    scale: saved.customSkinScale ?? base.skinPlacements.custom.scale,
    offsetX: saved.customSkinOffsetX ?? base.skinPlacements.custom.offsetX,
    offsetY: saved.customSkinOffsetY ?? base.skinPlacements.custom.offsetY,
    scaleMode: saved.skinPlacements?.custom?.scaleMode ?? base.skinPlacements.custom.scaleMode
  }
  const savedSkins = Array.isArray(saved.customSkins)
    ? saved.customSkins.filter(
        (item): item is CustomSkin =>
          !!item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.fileName === 'string' &&
          typeof item.mimeType === 'string' &&
          typeof item.animated === 'boolean' &&
          typeof item.createdAt === 'string'
      )
    : []
  // 将老版本的单张皮肤无损迁移到新皮肤库；文件仍由原先的 customSkinFile 指向。
  const savedFolders = Array.isArray(saved.customSkinFolders)
    ? saved.customSkinFolders.filter(
        (item): item is CustomSkinFolder =>
          !!item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.createdAt === 'string'
      )
    : []
  const validFolderIds = new Set(savedFolders.map((folder) => folder.id))
  const migratedLegacySkin: CustomSkin[] =
    savedSkins.length === 0 && saved.customSkinFile
      ? [{ id: 'legacy-custom', name: '我的皮肤', folderId: '', shape: 'square', fileName: saved.customSkinFile, mimeType: 'image/png', animated: false, createdAt: '' }]
      : savedSkins.map((item) => ({
          ...item,
          folderId: validFolderIds.has(item.folderId) ? item.folderId : '',
          shape: item.shape === 'circle' ? 'circle' : 'square'
        }))
  const savedSelectedCustomSkinId = saved.selectedCustomSkinId ?? ''
  const selectedCustomSkinId = migratedLegacySkin.some((item) => item.id === savedSelectedCustomSkinId)
    ? savedSelectedCustomSkinId
    : migratedLegacySkin[0]?.id ?? ''
  const rawCustomPlacements = saved.customSkinPlacements ?? {}
  const customSkinPlacements: Record<string, SkinPlacement> = {}
  for (const item of migratedLegacySkin) {
    const savedPlacement = rawCustomPlacements[item.id]
    customSkinPlacements[item.id] = {
      ...legacyCustomPlacement,
      ...savedPlacement
    }
  }
  return {
    ...base,
    ...saved,
    activeWindow: { ...base.activeWindow, ...saved.activeWindow },
    dndWindow: { ...base.dndWindow, ...saved.dndWindow },
    preferredTags: saved.preferredTags?.length ? saved.preferredTags : base.preferredTags,
    skinPlacements: {
      ...base.skinPlacements,
      ...saved.skinPlacements,
      custom: { ...base.skinPlacements.custom, ...legacyCustomPlacement, ...saved.skinPlacements?.custom },
      cat: { ...base.skinPlacements.cat, ...saved.skinPlacements?.cat },
      dog: { ...base.skinPlacements.dog, ...saved.skinPlacements?.dog },
      robot: { ...base.skinPlacements.robot, ...saved.skinPlacements?.robot },
      gif: { ...base.skinPlacements.gif, ...saved.skinPlacements?.gif }
    },
    customSkins: migratedLegacySkin,
    customSkinFolders: savedFolders,
    selectedCustomSkinId,
    customSkinPlacements,
    llm: { ...base.llm, ...saved.llm }
  }
}

let state: PersistedState = defaultState()

export function loadState(): PersistedState {
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<PersistedState>
      state = {
        settings: mergeSettings(raw.settings),
        favorites: raw.favorites ?? []
      }
    } catch (err) {
      console.error('[store] 配置解析失败，使用默认值:', err)
      state = defaultState()
    }
  }
  return state
}

/** 原子写：先写临时文件再 rename，避免半写损坏 */
export function saveState(): void {
  const tmp = CONFIG_PATH + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, CONFIG_PATH)
}

export function getState(): PersistedState {
  return state
}

export function getSettings(): Settings {
  return state.settings
}

export function updateSettings(patch: Partial<Settings>): Settings {
  state.settings = mergeSettings({ ...state.settings, ...patch })
  saveState()
  return state.settings
}

export function toggleFavorite(id: string): boolean {
  const idx = state.favorites.indexOf(id)
  let favorited: boolean
  if (idx >= 0) {
    state.favorites.splice(idx, 1)
    favorited = false
  } else {
    state.favorites.push(id)
    favorited = true
  }
  saveState()
  return favorited
}

export function isFavorited(id: string): boolean {
  return state.favorites.includes(id)
}
