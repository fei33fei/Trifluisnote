import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import type { DocState } from '../shared/types'

/**
 * 每个 BrowserWindow 承载一个独立文档 —— 与 Typora 的多窗口模型一致，
 * 也和记事本一致：窗口之间互不影响，各自持有自己的文件路径。
 */
const windows = new Map<number, DocState>()

export function getDocState(win: BrowserWindow): DocState {
  return (
    windows.get(win.id) ?? {
      filePath: null,
      dirty: false,
      title: '未命名',
    }
  )
}

export function patchDocState(win: BrowserWindow, patch: Partial<DocState>): DocState {
  const next = { ...getDocState(win), ...patch }
  windows.set(win.id, next)
  return next
}

export function createWindow(initialPath?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 620,
    minHeight: 420,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Trifluisnote',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.mjs', import.meta.url)),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const initialContent =
    initialPath && existsSync(initialPath) ? readFileSync(initialPath, 'utf8') : ''
  const initialState: DocState = {
    filePath: initialPath ?? null,
    dirty: false,
    title: initialPath ? basename(initialPath) : '未命名',
    content: initialContent,
  }
  windows.set(win.id, initialState)

  win.once('ready-to-show', () => win.show())

  win.on('closed', () => {
    windows.delete(win.id)
  })

  // 外部链接交给系统浏览器，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    void import('electron').then(({ shell }) => shell.openExternal(url))
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
  }

  return win
}

export function allWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows()
}

export function broadcastDocState(state: DocState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('docstate:changed', state)
  }
}
