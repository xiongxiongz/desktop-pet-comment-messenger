import type { PushPayload, SettingsView } from '../../main/types'
import { getSkinSvg, type SkinId } from './skins'

const api = window.api

const petEl = document.getElementById('pet') as HTMLDivElement
const petBody = document.getElementById('pet-body') as HTMLDivElement
const petName = document.getElementById('pet-name') as HTMLDivElement
const stage = document.getElementById('stage') as HTMLDivElement

const bubble = document.getElementById('bubble') as HTMLDivElement
const bubbleTag = document.getElementById('bubble-tag') as HTMLSpanElement
const bubbleLike = document.getElementById('bubble-like') as HTMLSpanElement
const bubbleText = document.getElementById('bubble-text') as HTMLParagraphElement
const bubbleAuthor = document.getElementById('bubble-author') as HTMLSpanElement
const bubbleVideo = document.getElementById('bubble-video') as HTMLSpanElement
const btnFav = document.getElementById('btn-fav') as HTMLButtonElement
const btnSkip = document.getElementById('btn-skip') as HTMLButtonElement

let current: PushPayload | null = null
let bubbleTimer: ReturnType<typeof setTimeout> | null = null

// ---- 皮肤与名称 ----
function applySettings(s: SettingsView): void {
  petBody.innerHTML = getSkinSvg(s.skin as SkinId)
  petName.textContent = s.petName
}

async function refreshSettings(): Promise<void> {
  const s = await api.loadSettings()
  applySettings(s)
}

// 设置页保存后，main 广播新设置 → 立即刷新皮肤/名称
api.onSettingsChanged((s) => applySettings(s))

// ---- 点击穿透：默认穿透，指针进入桌宠/气泡命中区时放开 ----
// stage 全窗口透明，实际命中元素是 pet 和 bubble。
function bindClickThrough(el: HTMLElement): void {
  el.addEventListener('pointerenter', () => api.setClickThrough(false))
  el.addEventListener('pointerleave', () => api.setClickThrough(true))
}
bindClickThrough(petEl)
bindClickThrough(bubble)

// ---- 拖拽移动：pointerdown 记起点，pointermove 让 main 移动窗口 ----
let dragging = false
let lastX = 0
let lastY = 0

petEl.addEventListener('pointerdown', (e) => {
  dragging = true
  lastX = e.screenX
  lastY = e.screenY
  petEl.setPointerCapture(e.pointerId)
})
petEl.addEventListener('pointermove', (e) => {
  if (!dragging) return
  const dx = e.screenX - lastX
  const dy = e.screenY - lastY
  lastX = e.screenX
  lastY = e.screenY
  if (dx !== 0 || dy !== 0) api.movePet(dx, dy)
})
function endDrag(e: PointerEvent): void {
  if (!dragging) return
  dragging = false
  try {
    petEl.releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
}
petEl.addEventListener('pointerup', endDrag)
petEl.addEventListener('pointercancel', endDrag)

// 双击桌宠打开设置
petEl.addEventListener('dblclick', () => api.openSettings())

// ---- 气泡展示 ----
function showBubble(payload: PushPayload): void {
  current = payload
  bubbleTag.textContent = payload.tag
  bubbleLike.textContent = `${payload.kind === 'danmu' ? '弹幕' : '评论'} · 👍 ${payload.likeCount}`
  bubbleText.textContent = payload.text
  bubbleAuthor.textContent = `—— ${payload.author}`
  bubbleVideo.textContent = `📺 ${payload.videoTitle}`
  btnFav.classList.toggle('active', payload.favorited)
  btnFav.textContent = payload.favorited ? '★ 已收藏' : '☆ 收藏'
  bubble.classList.remove('hidden')
  // 命中区扩大：气泡显示期间也需可交互（已 bindClickThrough）

  // 自动收起（给足阅读时间）
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => hideBubble(), 15_000)
}

function hideBubble(): void {
  bubble.classList.add('hidden')
  current = null
  if (bubbleTimer) {
    clearTimeout(bubbleTimer)
    bubbleTimer = null
  }
}

btnSkip.addEventListener('click', () => {
  api.skipComment()
  hideBubble()
})

btnFav.addEventListener('click', async () => {
  if (!current) return
  const favorited = await api.favoriteComment(current.id)
  current.favorited = favorited
  btnFav.classList.toggle('active', favorited)
  btnFav.textContent = favorited ? '★ 已收藏' : '☆ 收藏'
})

// ---- 接收推送 ----
api.onShowComment((payload) => showBubble(payload))

// 阻止右键菜单，避免透明窗口出现系统菜单
stage.addEventListener('contextmenu', (e) => e.preventDefault())

void refreshSettings()
