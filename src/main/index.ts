import { app, BrowserWindow, Menu } from 'electron'
import { filesFromArgv, registerIpc } from './ipc'
import { buildMenu } from './menu'
import { createWindow } from './windows'

/**
 * 打开一批文件：每个文件一个窗口（记事本式多窗口模型），
 * 没有文件时开一个空白窗口。
 */
function openPaths(paths: string[]): void {
  if (paths.length === 0) {
    createWindow()
    return
  }
  for (const path of paths) createWindow(path)
}

// 单实例：第二次启动时把文件交给已有实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = filesFromArgv(argv)
    if (files.length === 0) {
      // 没有带文件：把已有窗口叫到前台就行
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
      return
    }
    const wins = files.map((file) => createWindow(file))
    for (const win of wins) win.focus()
  })
}

// macOS：双击 .md 走的是 open-file 事件，不是命令行参数
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  openPaths([filePath])
})

app.whenReady().then(() => {
  app.setAppUserModelId('io.trifluisnote.app')
  registerIpc()
  Menu.setApplicationMenu(buildMenu())

  openPaths(filesFromArgv(process.argv))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
