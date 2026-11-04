import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import type { DocState } from '../shared/types'
import { decodeText } from './encoding'

/**
 * 每个 BrowserWindow 承载一个独立文档 —— 记事本式多窗口模型，
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

  /**
   * 打开窗口时带进来的文件。
   *
   * 编码必须在这里就探测好：老 md 文件是 GBK，按 UTF-8 读会整篇乱码，
   * 用户看到的就是「文件打不开」。探测到的编码存进 DocState，
   * 保存时按它写回去，不改用户文件的编码。
   */
  let initialContent = ''
  let initialEncoding: DocState['encoding'] = 'utf8'
  if (initialPath && existsSync(initialPath)) {
    try {
      const decoded = decodeText(readFileSync(initialPath))
      initialContent = decoded.content
      initialEncoding = decoded.encoding
    } catch {
      initialContent = ''
    }
  }

  const initialState: DocState = {
    filePath: initialPath ?? null,
    dirty: false,
    title: initialPath ? basename(initialPath) : '未命名',
    content: initialContent,
    encoding: initialEncoding,
  }
  windows.set(win.id, initialState)

  // 窗口标题要带文件名，否则任务栏/资源管理器里全是「Trifluisnote」，
  // 多开几个窗口根本分不清哪个是哪个。
  if (initialPath) win.setTitle(`${basename(initialPath)} — Trifluisnote`)

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
