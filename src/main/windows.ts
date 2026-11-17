import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import type { FileEncoding, StartupState, TabState } from '../shared/types'
import { dropWindow } from './autosave'
import { decodeText } from './encoding'
import { takeStartupContent } from './startup'

/**
 * 每个窗口的状态。
 *
 * v0.2 起一个窗口里可以有多个标签页，窗口持有的是「标签页清单」，
 * 正文内容仍然留在渲染层（每个标签页一个编辑器实例）。
 * 主进程只镜像一份轻量状态，用来更新窗口标题、判断「这个文件是不是已经开着」。
 *
 * ⚠ 启动时的状态（startup*）是**不可变**的：
 * 渲染层挂载后会立刻把「当前标签页清单」同步回来（那时可能还是空的），
 * 如果启动状态和当前状态共用一份字段，第一次同步就会把启动信息冲掉 ——
 * 表现为「用文件启动应用，标签页标题却是『未命名』」。
 */
interface WindowState {
  /** 启动时的标签页清单 */
  startupTabs: TabState[]
  startupActiveTabId: string
  /** 启动时带进来的文档内容 */
  initialContent: string
  /** 当前标签页清单（渲染层同步过来的） */
  tabs: TabState[]
  activeTabId: string
}

const windows = new Map<number, WindowState>()

/** 造一个标签页 id。 */
export function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function getWindowState(win: BrowserWindow): WindowState {
  return (
    windows.get(win.id) ?? {
      startupTabs: [],
      startupActiveTabId: '',
      initialContent: '',
      tabs: [],
      activeTabId: '',
    }
  )
}

/** 渲染层启动时取回的初始状态。 */
export function getStartupState(win: BrowserWindow): StartupState {
  const state = getWindowState(win)
  return {
    tabs: state.startupTabs,
    activeTabId: state.startupActiveTabId,
    content: state.initialContent,
  }
}

/**
 * 同步标签页清单。
 *
 * 主进程不保存正文，只保存路径 / 标题 / 脏标记 —— 足够更新窗口标题，
 * 也足够在「打开一个已经开着的文件」时判断该切到哪个标签页。
 */
export function syncTabs(win: BrowserWindow, tabs: TabState[], activeTabId: string): void {
  const state = getWindowState(win)
  state.tabs = tabs
  state.activeTabId = activeTabId
  windows.set(win.id, state)
  updateWindowTitle(win)
}

/** 按窗口标题刷新。 */
export function updateWindowTitle(win: BrowserWindow): void {
  const state = getWindowState(win)
  const active = state.tabs.find((t) => t.id === state.activeTabId)
  if (!active) {
    win.setTitle('Trifluisnote')
    return
  }
  const count = state.tabs.length > 1 ? ` [${state.tabs.length}]` : ''
  win.setTitle(`${active.title}${active.dirty ? ' •' : ''} — Trifluisnote${count}`)
}

/**
 * 查某个文件路径在当前窗口里的编码。
 *
 * 保存时如果调用方没给编码，就用它 ——
 * 老 md 文件是 GBK 的，不能因为少传一个参数就被悄悄改成 UTF-8。
 */
export function findEncodingForPath(win: BrowserWindow, filePath: string): FileEncoding | undefined {
  const state = getWindowState(win)
  const tab = state.tabs.find((t) => t.filePath === filePath)
  return tab?.encoding
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
   * 用户看到的就是「文件打不开」。探测到的编码存进标签页状态，
   * 保存时按它写回去，不改用户文件的编码。
   *
   * 没有文件时：空白页。
   * 只有「安装后第一次启动」才会拿到一段启动内容（取走即失效），
   * 之后每次启动都是干净的空白页。
   */
  let initialContent = ''
  let initialEncoding: TabState['encoding'] = 'utf8'
  if (initialPath && existsSync(initialPath)) {
    try {
      const decoded = decodeText(readFileSync(initialPath))
      initialContent = decoded.content
      initialEncoding = decoded.encoding
    } catch {
      initialContent = ''
    }
  } else if (!initialPath) {
    /**
     * 没有指定文件 —— 也就是「用户自己双击了图标」这一路。
     *
     * 这里才谈得上启动内容：安装后第一次启动给一次示例文档，
     * 之后每次都是空白页。带路径启动（双击 .md、命令行传文件）
     * 一律用文件自己的内容，绝不拿示例去覆盖 ——
     * 哪怕那个路径指向的文件已经不在了，也宁可留空白页。
     */
    initialContent = takeStartupContent() ?? ''
  }

  const firstTab: TabState = {
    id: newTabId(),
    filePath: initialPath ?? null,
    title: initialPath ? basename(initialPath) : '未命名',
    dirty: false,
    encoding: initialEncoding,
  }

  windows.set(win.id, {
    startupTabs: [firstTab],
    startupActiveTabId: firstTab.id,
    initialContent,
    tabs: [firstTab],
    activeTabId: firstTab.id,
  })

  if (initialPath) win.setTitle(`${basename(initialPath)} — Trifluisnote`)

  win.once('ready-to-show', () => win.show())

  win.on('closed', () => {
    windows.delete(win.id)
    // 窗口没了，它下面挂着的待落盘内容也一并清掉
    dropWindow(win.id)
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
