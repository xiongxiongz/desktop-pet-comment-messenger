import { app, BrowserWindow, Menu, nativeImage, screen, shell, Tray } from 'electron'
import { join } from 'node:path'

// 唯一放置 BrowserWindow 选项处，平台微调集中于此。

const isDev = !!process.env['ELECTRON_RENDERER_URL']

const PET_WIDTH = 360
// 桌宠底部锚定，窗口加高的空间全部落在顶部，正好给向上生长的评论气泡留出阅读区。
const PET_HEIGHT = 480
const PET_EDGE_VISIBLE_RATIO = 0.2
// 桌宠本体在 360px 透明窗口中的实际布局，需与 pet.css 的 .pet 保持一致。
const PET_CONTENT_WIDTH = 160
const PET_CONTENT_RIGHT_GAP = 24

let petWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null
let petDragStart: { cursorX: number; cursorY: number; windowX: number; windowY: number } | null = null
let petTray: Tray | null = null
let petPositionBeforeDock: { x: number; y: number } | null = null
let isPetDocked = false

function createPetTrayIcon() {
  // 使用高对比粉色圆底与白色爪印；不作为 template image，深浅菜单栏中都清晰可见。
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#F2558C"/><circle cx="9.8" cy="11.2" r="2.45" fill="#fff"/><circle cx="15.9" cy="8.9" r="2.45" fill="#fff"/><circle cx="22.1" cy="11.2" r="2.45" fill="#fff"/><ellipse cx="16" cy="20.4" rx="6.55" ry="5.25" fill="#fff"/></svg>`
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 22, height: 22 })
}

function ensurePetTray(): Tray {
  if (petTray && !petTray.isDestroyed()) return petTray
  petTray = new Tray(createPetTrayIcon())
  petTray.setToolTip('桌宠评论信使（点击展开）')
  petTray.on('click', () => showPetWindow())
  petTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '展开桌宠', click: () => showPetWindow() },
      { label: '打开设置', click: () => createSettingsWindow().show() },
      { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() }
    ])
  )
  return petTray
}

function rendererUrl(page: 'pet' | 'settings'): { url?: string; file?: string } {
  if (isDev) {
    return { url: `${process.env['ELECTRON_RENDERER_URL']}/${page}/index.html` }
  }
  return { file: join(__dirname, `../renderer/${page}/index.html`) }
}

function loadPage(win: BrowserWindow, page: 'pet' | 'settings'): void {
  const target = rendererUrl(page)
  if (target.url) void win.loadURL(target.url)
  else if (target.file) void win.loadFile(target.file)
}

export function createPetWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  petWin = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    // 初始停在工作区右下角
    x: workArea.x + workArea.width - PET_WIDTH - 24,
    y: workArea.y + workArea.height - PET_HEIGHT - 24,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    focusable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  petWin.setAlwaysOnTop(true, 'floating')
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  // 默认忽略鼠标事件（透明区可穿透），forward:true 使 renderer 仍收到 pointermove
  petWin.setIgnoreMouseEvents(true, { forward: true })

  loadPage(petWin, 'pet')
  petWin.on('closed', () => {
    petWin = null
    petPositionBeforeDock = null
    isPetDocked = false
  })
  return petWin
}

export function createSettingsWindow(): BrowserWindow {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus()
    return settingsWin
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 720,
    title: '桌宠评论信使',
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  settingsWin.on('ready-to-show', () => settingsWin?.show())
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  loadPage(settingsWin, 'settings')
  settingsWin.on('closed', () => {
    settingsWin = null
  })
  return settingsWin
}

export function getPetWindow(): BrowserWindow | null {
  return petWin
}

function clampPetPosition(x: number, y: number, workArea: Electron.Rectangle): { x: number; y: number } {
  return {
    x: Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - PET_WIDTH)),
    y: Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - PET_HEIGHT))
  }
}

/** 将桌宠收起到当前屏幕的右侧，保留约 20% 的宽度可见。 */
export function dockPetToRightEdge(): void {
  if (!petWin || petWin.isDestroyed()) return

  const [currentX, currentY] = petWin.getPosition()
  if (!isPetDocked) petPositionBeforeDock = { x: currentX, y: currentY }

  const { workArea } = screen.getDisplayMatching(petWin.getBounds())
  const visibleWidth = Math.round(PET_CONTENT_WIDTH * PET_EDGE_VISIBLE_RATIO)
  const { y } = clampPetPosition(currentX, currentY, workArea)
  // `.pet` 位于透明窗口右侧（right: 24px）。要露出本体的 20%，
  // 窗口本身不能只按 20% 留在屏幕内，否则宠物会完全被移出屏幕。
  const petLeftInsideWindow = PET_WIDTH - PET_CONTENT_RIGHT_GAP - PET_CONTENT_WIDTH
  const dockedX = workArea.x + workArea.width - visibleWidth - petLeftInsideWindow

  ensurePetTray()
  petDragStart = null
  petWin.show()
  petWin.setIgnoreMouseEvents(false)
  petWin.setPosition(dockedX, y)
  petWin.setAlwaysOnTop(true, 'floating')
  isPetDocked = true
}

export function showPetWindow(): void {
  if (!petWin || petWin.isDestroyed()) return
  petWin.show()
  if (isPetDocked && petPositionBeforeDock) {
    const { workArea } = screen.getDisplayMatching(petWin.getBounds())
    const position = clampPetPosition(petPositionBeforeDock.x, petPositionBeforeDock.y, workArea)
    petWin.setPosition(position.x, position.y)
  }
  petPositionBeforeDock = null
  isPetDocked = false
  petWin.setAlwaysOnTop(true, 'floating')
  petWin.setIgnoreMouseEvents(true, { forward: true })
}

/** 桌宠本体右键菜单。 */
export function showPetContextMenu(): void {
  const menu = Menu.buildFromTemplate([
    { label: '收起到右侧（露出 20%）', click: () => dockPetToRightEdge() },
    { label: '打开设置', click: () => createSettingsWindow().show() },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() }
  ])
  menu.popup({ window: petWin && !petWin.isDestroyed() ? petWin : undefined })
}

export function setPetClickThrough(enabled: boolean): void {
  if (petWin && !petWin.isDestroyed()) {
    petWin.setIgnoreMouseEvents(enabled, { forward: true })
  }
}

export function movePetBy(dx: number, dy: number): void {
  if (petWin && !petWin.isDestroyed()) {
    const [x, y] = petWin.getPosition()
    petWin.setPosition(Math.round(x + dx), Math.round(y + dy))
  }
}

/** 在主进程记录拖动起点，避免窗口移动后 renderer 的相对坐标产生跳动。 */
export function beginPetDrag(cursorX: number, cursorY: number): void {
  if (!petWin || petWin.isDestroyed() || !Number.isFinite(cursorX) || !Number.isFinite(cursorY)) return
  const [windowX, windowY] = petWin.getPosition()
  petDragStart = { cursorX, cursorY, windowX, windowY }
  petWin.setIgnoreMouseEvents(false)
}

/** 根据鼠标绝对屏幕坐标移动，拖动全程始终保留鼠标事件。 */
export function movePetToCursor(cursorX: number, cursorY: number): void {
  if (!petWin || petWin.isDestroyed() || !petDragStart || !Number.isFinite(cursorX) || !Number.isFinite(cursorY)) return
  petWin.setPosition(
    Math.round(petDragStart.windowX + cursorX - petDragStart.cursorX),
    Math.round(petDragStart.windowY + cursorY - petDragStart.cursorY)
  )
}

export function endPetDrag(): void {
  petDragStart = null
}
