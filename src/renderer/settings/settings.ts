import type { CommentTag, Settings, SettingsView } from '../../main/types'
import { COMMENT_TAGS } from '../../main/types'

const api = window.api

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const petName = $<HTMLInputElement>('petName')
const skin = $<HTMLSelectElement>('skin')
const tagsBox = $<HTMLDivElement>('tags')
const pushEnabled = $<HTMLInputElement>('pushEnabled')
const activeStart = $<HTMLInputElement>('activeStart')
const activeEnd = $<HTMLInputElement>('activeEnd')
const dndStart = $<HTMLInputElement>('dndStart')
const dndEnd = $<HTMLInputElement>('dndEnd')
const dailyCap = $<HTMLInputElement>('dailyCap')
const minInterval = $<HTMLInputElement>('minInterval')
const maxInterval = $<HTMLInputElement>('maxInterval')
const llmEnabled = $<HTMLInputElement>('llmEnabled')
const llmKey = $<HTMLInputElement>('llmKey')
const llmHint = $<HTMLParagraphElement>('llmHint')
const btnFilter = $<HTMLButtonElement>('btnFilter')
const filterResult = $<HTMLParagraphElement>('filterResult')
const btnPushOne = $<HTMLButtonElement>('btnPushOne')
const btnRefreshFav = $<HTMLButtonElement>('btnRefreshFav')
const favList = $<HTMLDivElement>('favList')
const saveStatus = $<HTMLSpanElement>('saveStatus')

let selectedTags = new Set<CommentTag>()

// ---- 标签 chip ----
function renderTags(): void {
  tagsBox.innerHTML = ''
  for (const tag of COMMENT_TAGS) {
    const chip = document.createElement('div')
    chip.className = 'tag-chip' + (selectedTags.has(tag) ? ' on' : '')
    chip.textContent = tag
    chip.addEventListener('click', () => {
      if (selectedTags.has(tag)) selectedTags.delete(tag)
      else selectedTags.add(tag)
      chip.classList.toggle('on')
      void save()
    })
    tagsBox.appendChild(chip)
  }
}

function updateLlmHint(view: SettingsView): void {
  if (view.llmHasKey) {
    llmHint.textContent = view.llmEnabled ? '已启用 glm-5.2 语义分类。' : '已检测到 key，勾选即可启用。'
  } else {
    llmHint.textContent = '未配置 key，将使用规则分类（可正常演示）。'
  }
}

// ---- 载入 ----
function fill(view: SettingsView): void {
  petName.value = view.petName
  skin.value = view.skin
  selectedTags = new Set(view.preferredTags)
  renderTags()
  pushEnabled.checked = view.pushEnabled
  activeStart.value = view.activeWindow.start
  activeEnd.value = view.activeWindow.end
  dndStart.value = view.dndWindow.start
  dndEnd.value = view.dndWindow.end
  dailyCap.value = String(view.dailyCap)
  minInterval.value = String(view.minIntervalSec)
  maxInterval.value = String(view.maxIntervalSec)
  llmEnabled.checked = view.llmEnabled
  updateLlmHint(view)
}

// ---- 保存（收集当前表单为 patch） ----
let saveTimer: ReturnType<typeof setTimeout> | null = null

function collect(): Partial<Settings> {
  const patch: Partial<Settings> = {
    petName: petName.value.trim() || '朋友',
    skin: skin.value as Settings['skin'],
    preferredTags: [...selectedTags],
    pushEnabled: pushEnabled.checked,
    activeWindow: { start: activeStart.value || '09:00', end: activeEnd.value || '23:00' },
    dndWindow: { start: dndStart.value || '12:00', end: dndEnd.value || '13:00' },
    dailyCap: Math.max(1, Number(dailyCap.value) || 20),
    minIntervalSec: Math.max(5, Number(minInterval.value) || 30),
    maxIntervalSec: Math.max(5, Number(maxInterval.value) || 120)
  }
  // llm：只在勾选或填写了 key 时下发，避免空值覆盖
  const llmPatch: Partial<Settings['llm']> = { enabled: llmEnabled.checked }
  if (llmKey.value.trim()) llmPatch.apiKey = llmKey.value.trim()
  patch.llm = llmPatch as Settings['llm']
  return patch
}

async function save(): Promise<void> {
  const view = await api.saveSettings(collect())
  updateLlmHint(view)
  saveStatus.textContent = '已保存 ✓'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => (saveStatus.textContent = ''), 1500)
}

// 变更即存（debounce 文本输入）
let inputTimer: ReturnType<typeof setTimeout> | null = null
function debouncedSave(): void {
  if (inputTimer) clearTimeout(inputTimer)
  inputTimer = setTimeout(() => void save(), 400)
}

for (const el of [petName, llmKey]) {
  el.addEventListener('input', debouncedSave)
}
for (const el of [
  skin,
  pushEnabled,
  activeStart,
  activeEnd,
  dndStart,
  dndEnd,
  dailyCap,
  minInterval,
  maxInterval,
  llmEnabled
]) {
  el.addEventListener('change', () => void save())
}

// ---- 筛选 / 推送 / 关闭 ----
btnFilter.addEventListener('click', async () => {
  btnFilter.disabled = true
  filterResult.textContent = '筛选中…'
  await save() // 确保用最新偏好筛选
  try {
    const res = await api.runFilterBatch()
    const via = res.usedLlm ? 'glm-5.2 语义分类' : '规则分类'
    filterResult.textContent = `已从 ${res.total} 条中筛选出 ${res.filtered} 条（${via}）`
  } catch {
    filterResult.textContent = '筛选失败，请重试'
  } finally {
    btnFilter.disabled = false
  }
})

btnPushOne.addEventListener('click', async () => {
  const ok = await api.requestOnePush()
  if (!ok) {
    filterResult.textContent = '暂无可推送的评论，请先加载并筛选'
  }
})

// ---- 收藏列表 ----
async function renderFavorites(): Promise<void> {
  const items = await api.listFavorites()
  favList.innerHTML = ''
  if (items.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = '还没有收藏。桌宠弹出评论时点「☆ 收藏」即可存到这里。'
    favList.appendChild(empty)
    return
  }
  for (const it of items) {
    const card = document.createElement('div')
    card.className = 'fav-item'

    const head = document.createElement('div')
    head.className = 'fav-head'
    const tag = document.createElement('span')
    tag.className = 'tag-chip on'
    tag.textContent = it.tag ?? '未分类'
    const del = document.createElement('button')
    del.className = 'mini'
    del.textContent = '取消收藏'
    del.addEventListener('click', async () => {
      await api.favoriteComment(it.id) // 再次 toggle 即取消
      void renderFavorites()
    })
    head.append(tag, del)

    const text = document.createElement('p')
    text.className = 'fav-text'
    text.textContent = it.text

    const meta = document.createElement('p')
    meta.className = 'fav-meta'
    meta.textContent = `${it.author} · 《${it.videoTitle}》 · 👍 ${it.likeCount}`

    card.append(head, text, meta)
    favList.appendChild(card)
  }
}

btnRefreshFav.addEventListener('click', () => void renderFavorites())

// ---- 顶部 tab 切换 ----
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab')
const panels = {
  settings: $<HTMLDivElement>('panelSettings'),
  favorites: $<HTMLDivElement>('panelFavorites')
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab as keyof typeof panels
    tabs.forEach((t) => t.classList.toggle('active', t === tab))
    panels.settings.classList.toggle('active', target === 'settings')
    panels.favorites.classList.toggle('active', target === 'favorites')
    if (target === 'favorites') void renderFavorites() // 切到收藏页时刷新最新
  })
}

// ---- 启动 ----
void (async () => {
  const view = await api.loadSettings()
  fill(view)
  await renderFavorites()
})()
