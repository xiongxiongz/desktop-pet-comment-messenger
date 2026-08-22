import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type PersistedState, type Settings } from './types'

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
  return {
    ...base,
    ...saved,
    activeWindow: { ...base.activeWindow, ...saved.activeWindow },
    dndWindow: { ...base.dndWindow, ...saved.dndWindow },
    preferredTags: saved.preferredTags?.length ? saved.preferredTags : base.preferredTags,
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
