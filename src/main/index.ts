import { app, BrowserWindow } from 'electron'
import { loadState } from './store'
import { registerIpc } from './ipc'
import { createPetWindow, getPetWindow } from './windows'
import { scheduler } from './scheduler'

// 单实例锁：第二次启动时聚焦已有桌宠而非新开
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getPetWindow()
    if (win) win.show()
  })

  app.whenReady().then(() => {
    loadState()
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
