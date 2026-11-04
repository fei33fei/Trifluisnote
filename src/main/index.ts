import { app, BrowserWindow, Menu } from 'electron'
import { filesFromArgv, registerIpc } from './ipc'
import { buildMenu } from './menu'
import { createWindow } from './windows'

// 单实例：第二次启动时把文件交给已有实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = filesFromArgv(argv)
    const win = createWindow(files[0])
    win.focus()
  })
}

app.whenReady().then(() => {
  app.setAppUserModelId('io.trifluisnote.app')
  registerIpc()
  Menu.setApplicationMenu(buildMenu())

  const files = filesFromArgv(process.argv)
  createWindow(files[0])

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
