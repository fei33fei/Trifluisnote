import { app, BrowserWindow, Menu } from 'electron'
import { filesFromArgv, registerIpc } from './ipc'
import { buildMenu } from './menu'
import { createWindow } from './windows'
import { flushAll } from './autosave'
import { initStartup } from './startup'

/**
 * 打开一批文件。
 *
 * v0.2 起窗口内是标签页模型：优先把文件塞进已有窗口（新开标签页），
 * 一个窗口都没有时才开新窗口 —— 「记事本式一文件一窗口」不再是默认行为。
 */
function openPaths(paths: string[]): void {
  if (paths.length === 0) {
    createWindow()
    return
  }
  const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (focused && !focused.isDestroyed()) {
    focused.webContents.send('menu:command', 'file.openPaths', paths)
    if (focused.isMinimized()) focused.restore()
    focused.focus()
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
    openPaths(files)
  })
}

// macOS：双击 .md 走的是 open-file 事件，不是命令行参数
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  openPaths([filePath])
})

app.whenReady().then(() => {
  app.setAppUserModelId('io.trifluisnote.app')
  // 先判定「是不是安装后第一次启动」：这一次才允许给启动内容，
  // 之后每次启动都只开空白页。
  initStartup()
  registerIpc()
  Menu.setApplicationMenu(buildMenu())

  openPaths(filesFromArgv(process.argv))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/**
 * 退出前把待落盘的内容一次性写掉。
 *
 * 自动保存平时是「停止输入 2 秒后写盘」，退出这一刻可能还有没写的内容；
 * 这里补一次，保证用户按退出时磁盘上就是最新的。
 */
let flushed = false
app.on('before-quit', (event) => {
  if (flushed) return
  event.preventDefault()
  void flushAll()
    .catch(() => undefined)
    .finally(() => {
      flushed = true
      app.quit()
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
