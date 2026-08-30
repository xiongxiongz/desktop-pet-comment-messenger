import { app, BrowserWindow, protocol } from 'electron'
import { readFileSync } from 'node:fs'
import { loadState } from './store'
import { registerIpc } from './ipc'
import { createPetWindow, getPetWindow, showPetWindow } from './windows'
import { scheduler } from './scheduler'
import { getCandidateSkinPath, getCustomSkinMimeType, getCustomSkinPath } from './customSkin'
import { getReactionDbImage, getReactionPath, getReferencePath } from './aiReaction'

protocol.registerSchemesAsPrivileged([
  { scheme: 'pet-skin', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function registerCustomSkinProtocol(): void {
  protocol.handle('pet-skin', (request) => {
    const url = new URL(request.url)
    const host = url.hostname
    if (host !== 'library' && host !== 'candidate' && host !== 'reaction' && host !== 'ai-reference') return new Response('Not found', { status: 404 })

    const settings = loadState().settings
    const id = decodeURIComponent(url.pathname.slice(1))
    const item = host === 'library' && /^[a-zA-Z0-9-]{1,80}$/.test(id) ? settings.customSkins.find((skin) => skin.id === id) : null
    const reactionBytes = host === 'reaction' ? getReactionDbImage(id.replace(/\.png$/, '')) : null
    const path = host === 'candidate' ? getCandidateSkinPath() : host === 'reaction' ? getReactionPath(id) : host === 'ai-reference' ? getReferencePath(settings) : item ? getCustomSkinPath(item.fileName) : null
    const mime = host === 'candidate' || host === 'reaction' || host === 'ai-reference' ? 'image/png' : item ? getCustomSkinMimeType(item.fileName) : null
    if (!path && !reactionBytes || !mime) return new Response('Not found', { status: 404 })

    try {
      return new Response(reactionBytes ?? readFileSync(path!), {
        headers: { 'content-type': mime, 'cache-control': 'no-store' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

// 单实例锁：第二次启动时聚焦已有桌宠而非新开
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getPetWindow()
    if (win) showPetWindow()
  })

  app.whenReady().then(() => {
    loadState()
    registerCustomSkinProtocol()
    registerIpc()
    const petWin = createPetWindow()
    scheduler.attach(petWin)
    scheduler.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const win = createPetWindow()
        scheduler.attach(win)
        scheduler.start()
      }
    })
  })

  // 桌宠常驻应用：窗口全关不退出（macOS 习惯），由用户显式退出
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
