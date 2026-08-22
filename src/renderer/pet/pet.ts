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
let hasShownStartupGreeting = false

// ---- 皮肤与名称 ----
function applySettings(s: SettingsView): void {
  petName.textContent = s.petName
  petBody.classList.remove('custom-skin-circle', 'frame-scale')
  const actualSkin = s.skin === 'custom' && !s.customSkinUrl ? 'cat' : s.skin
  const placement = s.skinPlacements[actualSkin]
  const useFrameScale = placement.scaleMode === 'frame'
  petBody.classList.toggle('frame-scale', useFrameScale)
  petBody.style.setProperty('--frame-scale', String(useFrameScale ? placement.scale / 100 : 1))
  petBody.style.setProperty('--skin-scale', String(useFrameScale ? 1 : placement.scale / 100))
  petBody.style.setProperty('--skin-offset-x', `${placement.offsetX}px`)
  petBody.style.setProperty('--skin-offset-y', `${placement.offsetY}px`)
  if (s.skin === 'custom' && s.customSkinUrl) {
    petBody.classList.add('custom-skin-active')
    petBody.classList.toggle('custom-skin-circle', s.customSkins.find((item) => item.id === s.selectedCustomSkinId)?.shape === 'circle')
    const image = document.createElement('img')
    image.className = 'custom-skin'
    image.src = s.customSkinUrl
    image.alt = '自定义桌宠皮肤'
    // 图片默认会触发浏览器原生拖拽，导致中间区域无法交给桌宠的长按拖动处理。
    image.draggable = false
    petBody.replaceChildren(image)
    return
  }

  // 用户选择自定义图片但尚未上传时，保留默认猫作为可见回退。
  petBody.classList.add('custom-skin-active')
  petBody.innerHTML = getSkinSvg((s.skin === 'custom' ? 'cat' : s.skin) as SkinId)
}

async function refreshSettings(): Promise<void> {
  const s = await api.loadSettings()
  applySettings(s)
  if (!hasShownStartupGreeting) {
    hasShownStartupGreeting = true
    showStartupGreeting(s.petName)
  }
}

// 设置页保存后，main 广播新设置 → 立即刷新皮肤/名称
api.onSettingsChanged((s) => applySettings(s))

// ---- 点击穿透：默认穿透，指针进入桌宠/气泡命中区时放开 ----
// stage 全窗口透明，实际命中元素是 pet 和 bubble。
let dragging = false
let pressPending = false
let pressTimer: ReturnType<typeof setTimeout> | null = null
let pressedPointerId: number | null = null
let pressedCursor: { x: number; y: number } | null = null
let lastContextMenuAt = 0

function bindClickThrough(el: HTMLElement): void {
  // macOS 透明窗口在触摸板辅助点击前不一定派发 pointerenter，
  // 因此同时监听 over / mouseenter，尽早停止鼠标穿透。
  const receivePointer = () => api.setClickThrough(false)
  el.addEventListener('pointerover', receivePointer)
  el.addEventListener('pointerenter', receivePointer)
  el.addEventListener('mouseenter', receivePointer)
  el.addEventListener('pointerleave', () => {
    // 按住或拖动时窗口会跟着鼠标移动，不能因为暂时离开原命中区而恢复穿透。
    if (!dragging && !pressPending) api.setClickThrough(true)
  })
}
bindClickThrough(petEl)
bindClickThrough(bubble)

// ---- 拖拽移动：所有皮肤统一为“按住 300ms 后拖动” ----
// 主进程记录窗口起点，按鼠标绝对坐标稳定跟随。
const LONG_PRESS_DELAY = 300

function clearPendingPress(): void {
  if (pressTimer) clearTimeout(pressTimer)
  pressTimer = null
  pressPending = false
  pressedPointerId = null
  pressedCursor = null
  petEl.classList.remove('long-pressing')
}

function openPetContextMenu(e: Event): void {
  e.preventDefault()
  e.stopPropagation()
  // 触摸板辅助点击通常会依次触发 pointerdown、auxclick、contextmenu；只打开一次。
  if (Date.now() - lastContextMenuAt < 350) return
  lastContextMenuAt = Date.now()
  api.setClickThrough(false)
  api.showPetContextMenu()
}

petEl.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    openPetContextMenu(e)
    return
  }
  if (e.button !== 0) return

  clearPendingPress()
  pressPending = true
  pressedPointerId = e.pointerId
  pressedCursor = { x: e.screenX, y: e.screenY }
  api.setClickThrough(false)
  petEl.setPointerCapture(e.pointerId)
  petEl.classList.add('long-pressing')
  pressTimer = setTimeout(() => {
    if (!pressPending || !pressedCursor) return
    dragging = true
    pressPending = false
    pressTimer = null
    api.beginPetDrag(pressedCursor.x, pressedCursor.y)
    petEl.classList.remove('long-pressing')
    petEl.classList.add('dragging')
  }, LONG_PRESS_DELAY)
})
petEl.addEventListener('pointermove', (e) => {
  if (pressPending && e.pointerId === pressedPointerId) {
    // 长按期间以最新指针位置作为拖动起点，避免开始拖动时出现跳动。
    pressedCursor = { x: e.screenX, y: e.screenY }
  }
  if (!dragging) return
  api.movePetToCursor(e.screenX, e.screenY)
})
function endDrag(e: PointerEvent): void {
  if (pressedPointerId !== null && e.pointerId !== pressedPointerId) return
  const wasDragging = dragging
  clearPendingPress()
  if (!wasDragging) {
    try {
      petEl.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (!petEl.matches(':hover') && !bubble.matches(':hover')) api.setClickThrough(true)
    return
  }
  dragging = false
  petEl.classList.remove('dragging')
  api.endPetDrag()
  try {
    petEl.releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
  // 松开时只有鼠标不在桌宠或气泡上才恢复透明区域的点击穿透。
  if (!petEl.matches(':hover') && !bubble.matches(':hover')) api.setClickThrough(true)
}
petEl.addEventListener('pointerup', endDrag)
petEl.addEventListener('pointercancel', endDrag)

// 双击桌宠打开设置
petEl.addEventListener('dblclick', () => api.openSettings())
petEl.addEventListener('auxclick', openPetContextMenu)
petEl.addEventListener('contextmenu', openPetContextMenu)

// ---- 气泡展示 ----
function showBubble(payload: PushPayload): void {
  current = payload
  bubble.classList.remove('greeting')
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

/** 桌宠窗口启动后只问候一次，不占用评论推送或收藏状态。 */
function showStartupGreeting(name: string): void {
  current = null
  bubble.classList.add('greeting')
  bubbleTag.textContent = '你好'
  bubbleLike.textContent = ''
  bubbleText.textContent = `我是你的个人助手，${name || '朋友'}。`
  bubbleAuthor.textContent = ''
  bubbleVideo.textContent = ''
  bubble.classList.remove('hidden')
  if (bubbleTimer) clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => hideBubble(), 6_000)
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
