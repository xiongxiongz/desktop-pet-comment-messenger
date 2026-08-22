import type { CommentTag, PetSkin, Settings, SettingsView, SkinPlacement } from '../../main/types'
import { COMMENT_TAGS } from '../../main/types'

const api = window.api
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const petName = $<HTMLInputElement>('petName')
const skin = $<HTMLSelectElement>('skin')
const customSkinField = $<HTMLDivElement>('customSkinField')
const btnImportSkin = $<HTMLButtonElement>('btnImportSkin')
const customSkinPreviewStage = $<HTMLDivElement>('customSkinPreviewStage')
const customSkinPreview = $<HTMLImageElement>('customSkinPreview')
const customSkinLibrary = $<HTMLDivElement>('customSkinLibrary')
const skinFolderForm = $<HTMLDivElement>('skinFolderForm')
const skinFolderName = $<HTMLInputElement>('skinFolderName')
const btnConfirmSkinFolder = $<HTMLButtonElement>('btnConfirmSkinFolder')
const btnCancelSkinFolder = $<HTMLButtonElement>('btnCancelSkinFolder')
const skinAdjustments = $<HTMLDivElement>('skinAdjustments')
const btnContentScaleMode = $<HTMLButtonElement>('btnContentScaleMode')
const btnFrameScaleMode = $<HTMLButtonElement>('btnFrameScaleMode')
const customSkinScale = $<HTMLInputElement>('customSkinScale')
const customSkinScaleValue = $<HTMLSpanElement>('customSkinScaleValue')
const btnSkinUp = $<HTMLButtonElement>('btnSkinUp')
const btnSkinLeft = $<HTMLButtonElement>('btnSkinLeft')
const btnSkinRight = $<HTMLButtonElement>('btnSkinRight')
const btnSkinDown = $<HTMLButtonElement>('btnSkinDown')
const btnSkinReset = $<HTMLButtonElement>('btnSkinReset')
const customSkinHint = $<HTMLParagraphElement>('customSkinHint')
const skinCropDialog = $<HTMLDivElement>('skinCropDialog')
const skinCropStage = $<HTMLDivElement>('skinCropStage')
const skinCropImage = $<HTMLImageElement>('skinCropImage')
const skinCropName = $<HTMLInputElement>('skinCropName')
const skinCropFolder = $<HTMLSelectElement>('skinCropFolder')
const skinCropShape = $<HTMLSelectElement>('skinCropShape')
const skinCropScale = $<HTMLInputElement>('skinCropScale')
const skinCropScaleValue = $<HTMLSpanElement>('skinCropScaleValue')
const btnCancelSkinCrop = $<HTMLButtonElement>('btnCancelSkinCrop')
const btnConfirmSkinCrop = $<HTMLButtonElement>('btnConfirmSkinCrop')
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
let customSkinUrl: string | null = null
let customSkins: SettingsView['customSkins'] = []
let customSkinFolders: SettingsView['customSkinFolders'] = []
let selectedCustomSkinId = ''
const collapsedSkinFolders = new Set<string>()
const knownSkinFolderIds = new Set<string>()
let folderToExpandAfterCreate: string | null = null
let skinFolderFormMode: 'create' | 'rename' | 'rename-uncategorized' = 'create'
let editingFolderId = ''
let skinPlacements: Settings['skinPlacements']
let customSkinPlacements: Settings['customSkinPlacements']
let cropCandidateUrl: string | null = null
let cropOffsetX = 0
let cropOffsetY = 0
let cropDragging = false
let cropLastX = 0
let cropLastY = 0

const PET_DISPLAY_SIZE = 110
const defaultPlacement = (): SkinPlacement => ({ scale: 100, offsetX: 0, offsetY: 0, scaleMode: 'content' })

function currentScaleMode(): SkinPlacement['scaleMode'] {
  return btnFrameScaleMode.classList.contains('active') ? 'frame' : 'content'
}

function setScaleMode(mode: SkinPlacement['scaleMode']): void {
  const isFrameScale = mode === 'frame'
  btnContentScaleMode.classList.toggle('active', !isFrameScale)
  btnContentScaleMode.setAttribute('aria-pressed', String(!isFrameScale))
  btnFrameScaleMode.classList.toggle('active', isFrameScale)
  btnFrameScaleMode.setAttribute('aria-pressed', String(isFrameScale))
}

function applyPreviewTransform(): void {
  const scale = Number(customSkinScale.value) || 100
  const scaleMode = currentScaleMode()
  const frameScale = scaleMode === 'frame' ? scale / 100 : 1
  customSkinScaleValue.textContent = `${scale}%`
  customSkinPreviewStage.style.setProperty('--preview-frame-scale', String(frameScale))
  customSkinPreview.style.setProperty('--skin-scale', String(scaleMode === 'frame' ? 1 : scale / 100))
  customSkinPreview.style.setProperty('--skin-offset-x', `${Number(customSkinPreview.dataset.offsetX) || 0}px`)
  customSkinPreview.style.setProperty('--skin-offset-y', `${Number(customSkinPreview.dataset.offsetY) || 0}px`)
}

function selectedSkin(): PetSkin {
  return skin.value as PetSkin
}

function activePlacement(): SkinPlacement {
  if (selectedSkin() === 'custom' && selectedCustomSkinId) return customSkinPlacements[selectedCustomSkinId] ?? defaultPlacement()
  return skinPlacements[selectedSkin()] ?? defaultPlacement()
}

function setAdjustmentControls(placement: SkinPlacement): void {
  customSkinScale.value = String(placement.scale)
  setScaleMode(placement.scaleMode === 'frame' ? 'frame' : 'content')
  setSkinOffset(placement.offsetX, placement.offsetY)
}

function rememberActivePlacement(): void {
  const scaleMode = currentScaleMode()
  const placement = {
    scale: Math.max(50, Math.min(200, Number(customSkinScale.value) || 100)),
    offsetX: Number(customSkinPreview.dataset.offsetX) || 0,
    offsetY: Number(customSkinPreview.dataset.offsetY) || 0,
    scaleMode
  }
  if (selectedSkin() === 'custom' && selectedCustomSkinId) customSkinPlacements[selectedCustomSkinId] = placement
  else skinPlacements[selectedSkin()] = placement
}

function setSkinOffset(x: number, y: number): void {
  customSkinPreview.dataset.offsetX = String(Math.max(-80, Math.min(80, x)))
  customSkinPreview.dataset.offsetY = String(Math.max(-80, Math.min(80, y)))
  applyPreviewTransform()
}

function applyCropTransform(): void {
  const scale = Number(skinCropScale.value) || 100
  skinCropScaleValue.textContent = `${scale}%`
  skinCropImage.style.setProperty('--crop-scale', String(scale / 100))
  skinCropImage.style.setProperty('--crop-offset-x', `${cropOffsetX}px`)
  skinCropImage.style.setProperty('--crop-offset-y', `${cropOffsetY}px`)
}

function closeCropDialog(): void {
  cropCandidateUrl = null
  skinCropDialog.hidden = true
  skinCropImage.removeAttribute('src')
}

function openCropDialog(candidate: { url: string; defaultName: string }): void {
  cropCandidateUrl = candidate.url
  cropOffsetX = 0
  cropOffsetY = 0
  skinCropName.value = candidate.defaultName
  skinCropFolder.replaceChildren(new Option('自动新建文件夹（使用皮肤名称）', ''))
  for (const folder of customSkinFolders) skinCropFolder.add(new Option(folder.name, folder.id))
  skinCropShape.value = 'square'
  skinCropStage.classList.remove('circle')
  skinCropScale.value = '100'
  skinCropImage.src = candidate.url
  applyCropTransform()
  skinCropDialog.hidden = false
}

function folderLabel(folderId: string): string {
  return folderId ? customSkinFolders.find((folder) => folder.id === folderId)?.name ?? '未分类' : '未分类'
}

function closeSkinFolderForm(): void {
  skinFolderFormMode = 'create'
  editingFolderId = ''
  skinFolderName.value = ''
  skinFolderForm.hidden = true
}

function openSkinFolderForm(mode: 'create' | 'rename' | 'rename-uncategorized', folderId = '', name = ''): void {
  skinFolderFormMode = mode
  editingFolderId = folderId
  skinFolderName.value = name
  btnConfirmSkinFolder.textContent = mode === 'create' ? '创建' : mode === 'rename' ? '保存改名' : '创建并移动'
  skinFolderForm.hidden = false
  customSkinHint.textContent = mode === 'create'
    ? '输入文件夹名称后点击“创建”。'
    : mode === 'rename'
      ? '修改名称后点击“保存改名”。'
      : '会新建这个名称的文件夹，并把“未分类”里的皮肤全部移动进去。'
  skinFolderName.focus()
  skinFolderName.select()
}

async function submitSkinFolder(): Promise<void> {
  const name = skinFolderName.value.trim()
  if (!name) {
    customSkinHint.textContent = '请输入文件夹名称。'
    skinFolderName.focus()
    return
  }
  const mode = skinFolderFormMode
  const folderId = editingFolderId
  btnConfirmSkinFolder.disabled = true
  try {
    let view: SettingsView | null
    if (mode === 'create' || mode === 'rename-uncategorized') view = await api.createCustomSkinFolder(name)
    else view = await api.renameCustomSkinFolder(folderId, name)
    if (!view) {
      customSkinHint.textContent = '文件夹名称不能为空，最多 24 个字符。'
      return
    }
    if (mode === 'rename-uncategorized') {
      const newFolderId = view.customSkinFolders.at(-1)?.id
      if (!newFolderId) {
        customSkinHint.textContent = '创建文件夹失败，请重试。'
        return
      }
      for (const item of customSkins.filter((skin) => !skin.folderId)) {
        const moved = await api.moveCustomSkin(item.id, newFolderId)
        if (!moved) {
          customSkinHint.textContent = '部分皮肤未能移动，请重试。'
          return
        }
        view = moved
      }
      folderToExpandAfterCreate = newFolderId
    } else if (mode === 'create') folderToExpandAfterCreate = view.customSkinFolders.at(-1)?.id ?? null
    fill(view)
    closeSkinFolderForm()
    customSkinHint.textContent = mode === 'create'
      ? `已创建文件夹“${name}”。`
      : mode === 'rename'
        ? `已将文件夹改名为“${name}”。`
        : `已创建文件夹“${name}”，并移动了原“未分类”里的皮肤。`
  } finally {
    btnConfirmSkinFolder.disabled = false
  }
}

function renderSkinCard(item: SettingsView['customSkins'][number]): HTMLDivElement {
    const card = document.createElement('div')
    card.className = `skin-library-item${item.id === selectedCustomSkinId ? ' selected' : ''}`
    const image = document.createElement('img')
    image.className = 'skin-library-thumb'
    image.classList.toggle('circle', item.shape === 'circle')
    image.src = item.url
    image.alt = `${item.name} 缩略图`
    const body = document.createElement('div')
    body.className = 'skin-library-body'
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = 24
    input.value = item.name
    input.setAttribute('aria-label', '皮肤名称')
    const meta = document.createElement('span')
    meta.className = 'skin-library-meta'
    meta.textContent = `${item.animated ? '动态皮肤' : '静态皮肤'} · ${folderLabel(item.folderId)}`
    const actions = document.createElement('div')
    actions.className = 'skin-library-actions'
    const use = document.createElement('button')
    use.type = 'button'
    use.className = item.id === selectedCustomSkinId ? 'mini primary' : 'mini'
    use.textContent = item.id === selectedCustomSkinId ? '正在使用' : '使用'
    use.disabled = item.id === selectedCustomSkinId
    use.addEventListener('click', async () => {
      const view = await api.selectCustomSkin(item.id)
      if (view) fill(view)
    })
    const rename = document.createElement('button')
    rename.type = 'button'
    rename.className = 'mini'
    rename.textContent = '改名'
    rename.addEventListener('click', async () => {
      const view = await api.renameCustomSkin(item.id, input.value)
      if (view) fill(view)
      else customSkinHint.textContent = '名称不能为空，最多 24 个字符。'
    })
    const shape = document.createElement('select')
    shape.className = 'skin-shape-select'
    shape.setAttribute('aria-label', '皮肤显示形状')
    shape.add(new Option('方形', 'square'))
    shape.add(new Option('圆形', 'circle'))
    shape.value = item.shape
    shape.addEventListener('change', async () => {
      const view = await api.setCustomSkinShape(item.id, shape.value === 'circle' ? 'circle' : 'square')
      if (view) fill(view)
    })
    const move = document.createElement('select')
    move.className = 'skin-move-select'
    move.setAttribute('aria-label', '移动到皮肤文件夹')
    const uncategorized = new Option('移动到：未分类', '')
    move.add(uncategorized)
    for (const folder of customSkinFolders) move.add(new Option(`移动到：${folder.name}`, folder.id))
    move.value = item.folderId
    move.addEventListener('change', async () => {
      const view = await api.moveCustomSkin(item.id, move.value)
      if (view) fill(view)
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'mini skin-delete'
    remove.textContent = '删除'
    remove.addEventListener('click', async () => {
      if (!window.confirm(`确定删除皮肤“${item.name}”吗？此操作无法恢复。`)) return
      const view = await api.deleteCustomSkin(item.id)
      if (view) fill(view)
    })
    actions.append(use, rename, shape, move, remove)
    body.append(input, meta, actions)
    card.append(image, body)
    return card
}

function renderSkinFolder(folderId: string, name: string, items: SettingsView['customSkins'], isUncategorized: boolean): void {
  const section = document.createElement('section')
  section.className = 'skin-folder'
  const head = document.createElement('div')
  head.className = 'skin-folder-head'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'skin-folder-toggle'
  const collapsed = collapsedSkinFolders.has(folderId)
  toggle.textContent = `${collapsed ? '›' : '⌄'} 📁 ${name}（${items.length}）`
  toggle.setAttribute('aria-expanded', String(!collapsed))
  toggle.addEventListener('click', () => {
    if (collapsedSkinFolders.has(folderId)) collapsedSkinFolders.delete(folderId)
    else collapsedSkinFolders.add(folderId)
    renderSkinLibrary()
  })
  head.appendChild(toggle)
  if (isUncategorized) {
    const renameFolder = document.createElement('button')
    renameFolder.type = 'button'
    renameFolder.className = 'mini'
    renameFolder.textContent = '改名'
    renameFolder.addEventListener('click', () => openSkinFolderForm('rename-uncategorized', '', name))
    const deleteFolder = document.createElement('button')
    deleteFolder.type = 'button'
    deleteFolder.className = 'mini skin-delete'
    deleteFolder.textContent = '删除文件夹'
    deleteFolder.addEventListener('click', async () => {
      if (deleteFolder.dataset.confirming !== 'true') {
        deleteFolder.dataset.confirming = 'true'
        deleteFolder.textContent = '再次点击确认'
        customSkinHint.textContent = `再次点击“确认”会删除“未分类”中的 ${items.length} 张皮肤，此操作无法恢复。`
        window.setTimeout(() => {
          if (deleteFolder.dataset.confirming === 'true') {
            delete deleteFolder.dataset.confirming
            deleteFolder.textContent = '删除文件夹'
          }
        }, 3500)
        return
      }
      deleteFolder.disabled = true
      let latestView: SettingsView | null = null
      for (const item of items) {
        const view = await api.deleteCustomSkin(item.id)
        if (!view) {
          deleteFolder.disabled = false
          delete deleteFolder.dataset.confirming
          deleteFolder.textContent = '删除文件夹'
          customSkinHint.textContent = '部分皮肤删除失败，请重试。'
          return
        }
        latestView = view
      }
      if (latestView) fill(latestView)
      customSkinHint.textContent = '已删除“未分类”中的所有皮肤。'
    })
    head.append(renameFolder, deleteFolder)
  } else {
    const renameFolder = document.createElement('button')
    renameFolder.type = 'button'
    renameFolder.className = 'mini'
    renameFolder.textContent = '改名'
    renameFolder.addEventListener('click', () => openSkinFolderForm('rename', folderId, name))
    const deleteFolder = document.createElement('button')
    deleteFolder.type = 'button'
    deleteFolder.className = 'mini skin-delete'
    deleteFolder.textContent = '删除文件夹'
    deleteFolder.addEventListener('click', async () => {
      if (deleteFolder.dataset.confirming !== 'true') {
        deleteFolder.dataset.confirming = 'true'
        deleteFolder.textContent = '再次点击确认'
        customSkinHint.textContent = `再次点击“确认”删除“${name}”；其中 ${items.length} 张皮肤会移到“未分类”，图片不会被删除。`
        window.setTimeout(() => {
          if (deleteFolder.dataset.confirming === 'true') {
            delete deleteFolder.dataset.confirming
            deleteFolder.textContent = '删除文件夹'
          }
        }, 3500)
        return
      }
      deleteFolder.disabled = true
      const view = await api.deleteCustomSkinFolder(folderId)
      if (view) {
        fill(view)
        customSkinHint.textContent = `已删除文件夹“${name}”，里面的皮肤已移到“未分类”。`
      } else {
        deleteFolder.disabled = false
        delete deleteFolder.dataset.confirming
        deleteFolder.textContent = '删除文件夹'
        customSkinHint.textContent = '删除文件夹失败，请重试。'
      }
    })
    head.append(renameFolder, deleteFolder)
  }
  section.appendChild(head)
  if (!collapsed) {
    const list = document.createElement('div')
    list.className = 'skin-folder-list'
    if (items.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'hint skin-folder-empty'
      empty.textContent = '这个文件夹里还没有皮肤。'
      list.appendChild(empty)
    } else {
      for (const item of items) list.appendChild(renderSkinCard(item))
    }
    section.appendChild(list)
  }
  customSkinLibrary.appendChild(section)
}

function renderSkinLibrary(): void {
  customSkinLibrary.replaceChildren()
  if (customSkins.length === 0 && customSkinFolders.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = '还没有皮肤。添加后可新建文件夹分类收纳。'
    customSkinLibrary.appendChild(empty)
    return
  }
  for (const folder of customSkinFolders) {
    renderSkinFolder(folder.id, folder.name, customSkins.filter((skin) => skin.folderId === folder.id), false)
  }
  const uncategorizedSkins = customSkins.filter((skin) => !skin.folderId)
  if (uncategorizedSkins.length > 0) renderSkinFolder('', '未分类', uncategorizedSkins, true)
}

function renderCustomSkinControl(): void {
  const isCustom = selectedSkin() === 'custom'
  customSkinField.hidden = !isCustom
  customSkinPreviewStage.hidden = !isCustom || !customSkinUrl
  skinAdjustments.hidden = isCustom && !customSkinUrl
  customSkinPreview.src = customSkinUrl ?? ''
  const activeCustomSkin = customSkins.find((item) => item.id === selectedCustomSkinId)
  customSkinPreviewStage.classList.toggle('circle', activeCustomSkin?.shape === 'circle')
  customSkinHint.textContent = isCustom
    ? customSkinUrl
      ? '每张皮肤会独立保存大小和位置；动态图会保持播放。'
      : '点击“添加皮肤”上传 PNG/JPG/WebP/GIF，支持 APNG 和动态 WebP。'
    : ''
  if (isCustom) renderSkinLibrary()
}

function renderTags(): void {
  tagsBox.innerHTML = ''
  for (const tag of COMMENT_TAGS) {
    const chip = document.createElement('div')
    chip.className = `tag-chip${selectedTags.has(tag) ? ' on' : ''}`
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
  llmHint.textContent = view.llmHasKey
    ? view.llmEnabled
      ? '已启用 glm-5.2 语义分类。'
      : '已检测到 key，勾选即可启用。'
    : '未配置 key，将使用规则分类（可正常演示）。'
}

function fill(view: SettingsView): void {
  petName.value = view.petName
  skin.value = view.skin
  customSkinUrl = view.customSkinUrl
  customSkins = view.customSkins
  customSkinFolders = view.customSkinFolders
  const visibleFolderIds = new Set(['', ...customSkinFolders.map((folder) => folder.id)])
  for (const id of [...collapsedSkinFolders]) {
    if (!visibleFolderIds.has(id)) collapsedSkinFolders.delete(id)
  }
  for (const id of visibleFolderIds) {
    if (!knownSkinFolderIds.has(id)) {
      collapsedSkinFolders.add(id)
      knownSkinFolderIds.add(id)
    }
  }
  if (folderToExpandAfterCreate) {
    collapsedSkinFolders.delete(folderToExpandAfterCreate)
    folderToExpandAfterCreate = null
  }
  selectedCustomSkinId = view.selectedCustomSkinId
  skinPlacements = structuredClone(view.skinPlacements)
  customSkinPlacements = structuredClone(view.customSkinPlacements)
  setAdjustmentControls(activePlacement())
  renderCustomSkinControl()
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

let saveTimer: ReturnType<typeof setTimeout> | null = null
function collect(): Partial<Settings> {
  const nextSkinPlacements = structuredClone(skinPlacements)
  // 桌宠窗口沿用 skinPlacements 渲染；当前自定义皮肤同步写入 custom 槽位，
  // 同时仍在 customSkinPlacements 中保留每张图各自的配置。
  if (selectedSkin() === 'custom' && selectedCustomSkinId) {
    nextSkinPlacements.custom = customSkinPlacements[selectedCustomSkinId] ?? defaultPlacement()
  }
  const patch: Partial<Settings> = {
    petName: petName.value.trim() || '朋友',
    skin: skin.value as Settings['skin'],
    skinPlacements: nextSkinPlacements,
    customSkinPlacements: structuredClone(customSkinPlacements),
    preferredTags: [...selectedTags],
    pushEnabled: pushEnabled.checked,
    activeWindow: { start: activeStart.value || '09:00', end: activeEnd.value || '23:00' },
    dndWindow: { start: dndStart.value || '12:00', end: dndEnd.value || '13:00' },
    dailyCap: Math.max(1, Number(dailyCap.value) || 20),
    minIntervalSec: Math.max(5, Number(minInterval.value) || 30),
    maxIntervalSec: Math.max(5, Number(maxInterval.value) || 120)
  }
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

let inputTimer: ReturnType<typeof setTimeout> | null = null
function debouncedSave(): void {
  if (inputTimer) clearTimeout(inputTimer)
  inputTimer = setTimeout(() => void save(), 400)
}

for (const el of [petName, llmKey]) el.addEventListener('input', debouncedSave)
for (const el of [skin, pushEnabled, activeStart, activeEnd, dndStart, dndEnd, dailyCap, minInterval, maxInterval, llmEnabled]) {
  el.addEventListener('change', () => void save())
}
skin.addEventListener('change', () => {
  setAdjustmentControls(activePlacement())
  renderCustomSkinControl()
})
customSkinScale.addEventListener('input', () => {
  applyPreviewTransform()
  rememberActivePlacement()
  debouncedSave()
})
function changeScaleMode(mode: SkinPlacement['scaleMode']): void {
  setScaleMode(mode)
  applyPreviewTransform()
  rememberActivePlacement()
  void save()
}
btnContentScaleMode.addEventListener('click', () => changeScaleMode('content'))
btnFrameScaleMode.addEventListener('click', () => changeScaleMode('frame'))
function moveSkinBy(dx: number, dy: number): void {
  setSkinOffset((Number(customSkinPreview.dataset.offsetX) || 0) + dx, (Number(customSkinPreview.dataset.offsetY) || 0) + dy)
  rememberActivePlacement()
  void save()
}
btnSkinUp.addEventListener('click', () => moveSkinBy(0, -4))
btnSkinLeft.addEventListener('click', () => moveSkinBy(-4, 0))
btnSkinRight.addEventListener('click', () => moveSkinBy(4, 0))
btnSkinDown.addEventListener('click', () => moveSkinBy(0, 4))
btnSkinReset.addEventListener('click', () => {
  customSkinScale.value = '100'
  setScaleMode('content')
  setSkinOffset(0, 0)
  rememberActivePlacement()
  void save()
})

btnImportSkin.addEventListener('click', async () => {
  btnImportSkin.disabled = true
  customSkinHint.textContent = '正在处理图片…'
  try {
    const candidate = await api.chooseCustomSkinCandidate()
    if (candidate) openCropDialog(candidate)
    else renderCustomSkinControl()
  } catch (err) {
    customSkinHint.textContent = err instanceof Error ? `处理失败：${err.message}` : '处理失败，请换一张图片重试。'
  } finally {
    btnImportSkin.disabled = false
  }
})

btnConfirmSkinFolder.addEventListener('click', () => void submitSkinFolder())
btnCancelSkinFolder.addEventListener('click', closeSkinFolderForm)
skinFolderName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void submitSkinFolder()
  if (event.key === 'Escape') closeSkinFolderForm()
})

skinCropScale.addEventListener('input', applyCropTransform)
skinCropShape.addEventListener('change', () => skinCropStage.classList.toggle('circle', skinCropShape.value === 'circle'))
skinCropStage.addEventListener('pointerdown', (event) => {
  if (!cropCandidateUrl) return
  cropDragging = true
  cropLastX = event.clientX
  cropLastY = event.clientY
  skinCropStage.setPointerCapture(event.pointerId)
  skinCropStage.classList.add('dragging')
})
skinCropStage.addEventListener('pointermove', (event) => {
  if (!cropDragging) return
  cropOffsetX += event.clientX - cropLastX
  cropOffsetY += event.clientY - cropLastY
  cropLastX = event.clientX
  cropLastY = event.clientY
  applyCropTransform()
})
function stopCropDrag(event: PointerEvent): void {
  if (!cropDragging) return
  cropDragging = false
  skinCropStage.classList.remove('dragging')
  try {
    skinCropStage.releasePointerCapture(event.pointerId)
  } catch {
    // Pointer may already have been released by the OS.
  }
}
skinCropStage.addEventListener('pointerup', stopCropDrag)
skinCropStage.addEventListener('pointercancel', stopCropDrag)
btnCancelSkinCrop.addEventListener('click', async () => {
  await api.discardCustomSkinCandidate()
  closeCropDialog()
  renderCustomSkinControl()
})
btnConfirmSkinCrop.addEventListener('click', async () => {
  if (!cropCandidateUrl) return
  btnConfirmSkinCrop.disabled = true
  try {
    const previewSize = skinCropStage.getBoundingClientRect().width
    const offsetRatio = previewSize > 0 ? PET_DISPLAY_SIZE / previewSize : 1
    const view = await api.confirmCustomSkin({
      name: skinCropName.value,
      folderId: skinCropFolder.value,
      shape: skinCropShape.value === 'circle' ? 'circle' : 'square',
      placement: {
        scale: Number(skinCropScale.value) || 100,
        offsetX: Math.round(cropOffsetX * offsetRatio),
        offsetY: Math.round(cropOffsetY * offsetRatio)
      }
    })
    if (!view) throw new Error('暂存图片已失效，请重新选择')
    closeCropDialog()
    fill(view)
  } catch (err) {
    customSkinHint.textContent = err instanceof Error ? `保存失败：${err.message}` : '保存失败，请重新选择图片。'
  } finally {
    btnConfirmSkinCrop.disabled = false
  }
})

btnFilter.addEventListener('click', async () => {
  btnFilter.disabled = true
  filterResult.textContent = '筛选中…'
  await save()
  try {
    const res = await api.runFilterBatch()
    filterResult.textContent = `已从 ${res.total} 条中筛选出 ${res.filtered} 条（${res.usedLlm ? 'glm-5.2 语义分类' : '规则分类'}）`
  } catch {
    filterResult.textContent = '筛选失败，请重试'
  } finally {
    btnFilter.disabled = false
  }
})
btnPushOne.addEventListener('click', async () => {
  if (!(await api.requestOnePush())) filterResult.textContent = '暂无可推送的评论，请先加载并筛选'
})

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
  for (const item of items) {
    const card = document.createElement('div')
    card.className = 'fav-item'
    const head = document.createElement('div')
    head.className = 'fav-head'
    const tag = document.createElement('span')
    tag.className = 'tag-chip on'
    tag.textContent = item.tag ?? '未分类'
    const remove = document.createElement('button')
    remove.className = 'mini'
    remove.textContent = '取消收藏'
    remove.addEventListener('click', async () => {
      await api.favoriteComment(item.id)
      void renderFavorites()
    })
    head.append(tag, remove)
    const text = document.createElement('p')
    text.className = 'fav-text'
    text.textContent = item.text
    const meta = document.createElement('p')
    meta.className = 'fav-meta'
    meta.textContent = `${item.author} · 《${item.videoTitle}》 · 👍 ${item.likeCount}`
    card.append(head, text, meta)
    favList.appendChild(card)
  }
}

btnRefreshFav.addEventListener('click', () => void renderFavorites())
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab')
const panels = { settings: $<HTMLDivElement>('panelSettings'), favorites: $<HTMLDivElement>('panelFavorites') }
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab as keyof typeof panels
    tabs.forEach((entry) => entry.classList.toggle('active', entry === tab))
    panels.settings.classList.toggle('active', target === 'settings')
    panels.favorites.classList.toggle('active', target === 'favorites')
    if (target === 'favorites') void renderFavorites()
  })
}

void (async () => {
  fill(await api.loadSettings())
  await renderFavorites()
})()
