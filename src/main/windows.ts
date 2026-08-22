import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'

// 唯一放置 BrowserWindow 选项处，平台微调集中于此。

const isDev = !!process.env['ELECTRON_RENDERER_URL']

const PET_WIDTH = 360
const PET_HEIGHT = 320

let petWin: BrowserWindow | null = null
let settingsWin: BrowserWindow | null = null

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
