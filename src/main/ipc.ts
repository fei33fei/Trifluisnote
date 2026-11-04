import { existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ExportPayload, ExportResult, OpenResult, SaveResult } from '../shared/types'
import { THEMES } from '../shared/theme-css'
import { buildExportHtml, renderPdf } from './export'
import { decodeText, encodeText } from './encoding'
import { createWindow, getDocState, patchDocState } from './windows'

/** Markdown 文件扩展名白名单。 */
const MD_EXT = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt']

function isMarkdownFile(filePath: string): boolean {
  return MD_EXT.includes(extname(filePath).toLowerCase())
}

/**
 * 读一个 Markdown 文件，返回内容与探测到的编码。
 *
 * 编码探测很关键：老的 md 文件是 GBK，硬按 UTF-8 读就是一篇乱码，
 * 用户会以为「文件打不开」。
 */
async function readMarkdown(filePath: string): Promise<OpenResult> {
  try {
    const buf = await readFile(filePath)
    const { content, encoding } = decodeText(buf)
    return { ok: true, filePath, content, encoding }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function registerIpc(): void {
  ipcMain.handle('dialog:open', async (event): Promise<OpenResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'no-window' }

    const result = await dialog.showOpenDialog(win, {
      title: '打开 Markdown 文件',
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: MD_EXT.map((e) => e.slice(1)) },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePaths[0]) return { ok: false }

    const filePath = result.filePaths[0]
    const res = await readMarkdown(filePath)
    if (!res.ok) return res
    patchDocState(win, {
      filePath,
      dirty: false,
      title: basename(filePath),
      encoding: res.encoding,
    })
    win.setTitle(`${basename(filePath)} — Trifluisnote`)
    return res
  })

  /**
   * 拖放打开：走主进程读取，和「打开…」按钮完全一致。
   *
   * 之前渲染层用 FileReader 自己读，只拿得到 UTF-8，
   * GBK 的老文件拖进来就是乱码，而且拿不到可靠的绝对路径。
   */
  ipcMain.handle('file:read', async (event, filePath: string): Promise<OpenResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'no-window' }
    if (!filePath || !existsSync(filePath)) return { ok: false, error: '文件不存在' }

    const res = await readMarkdown(filePath)
    if (!res.ok) return res
    patchDocState(win, {
      filePath,
      dirty: false,
      title: basename(filePath),
      encoding: res.encoding,
    })
    win.setTitle(`${basename(filePath)} — Trifluisnote`)
    return res
  })

  ipcMain.handle('file:save', async (event, filePath: string, content: string): Promise<SaveResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'no-window' }
    try {
      // 按原文件的编码写回，避免把用户的 GBK 文件悄悄改成 UTF-8
      const encoding = getDocState(win).encoding ?? 'utf8'
      await writeFile(filePath, encodeText(content, encoding))
      patchDocState(win, { filePath, dirty: false, title: basename(filePath) })
      win.setTitle(`${basename(filePath)} — Trifluisnote`)
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('file:saveAs', async (event, content: string, suggestedName?: string): Promise<SaveResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'no-window' }

    const result = await dialog.showSaveDialog(win, {
      title: '另存为',
      defaultPath: suggestedName ?? '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false }

    try {
      // 另存为是新文件：统一用无 BOM 的 UTF-8（现代默认，也对所有工具友好）
      await writeFile(result.filePath, encodeText(content, 'utf8'))
      patchDocState(win, {
        filePath: result.filePath,
        dirty: false,
        title: basename(result.filePath),
        encoding: 'utf8',
      })
      win.setTitle(`${basename(result.filePath)} — Trifluisnote`)
      return { ok: true, filePath: result.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('window:new', (): void => {
    createWindow()
  })

  ipcMain.handle('docstate:get', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? getDocState(win) : null
  })

  ipcMain.handle('docstate:set', (event, patch) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const next = patchDocState(win, patch)
    win.setTitle(`${next.title}${next.dirty ? ' •' : ''} — Trifluisnote`)
    return next
  })

  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }))

  ipcMain.handle('shell:reveal', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('theme:list', () => THEMES)

  ipcMain.handle('export:html', async (event, payload: ExportPayload, suggestedName: string): Promise<ExportResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'no-window' }

    const result = await dialog.showSaveDialog(win, {
      title: '导出为 HTML',
      defaultPath: suggestedName,
      filters: [{ name: 'HTML 网页', extensions: ['html'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }

    try {
      await writeFile(result.filePath, buildExportHtml(payload), 'utf8')
      return { ok: true, filePath: result.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('export:pdf', async (event, payload: ExportPayload, suggestedName: string): Promise<ExportResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'no-window' }

    const result = await dialog.showSaveDialog(win, {
      title: '导出为 PDF',
      defaultPath: suggestedName,
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }

    try {
      const buffer = await renderPdf(payload)
      await writeFile(result.filePath, buffer)
      return { ok: true, filePath: result.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}

/**
 * 命令行传入的文件路径（双击 .md 文件时由系统传入）。
 *
 * 要处理的几种形态：
 *   - `app.exe "C:\notes\a.md"`        资源管理器双击，最常见
 *   - `app.exe -- "C:\notes\a.md"`     带 `--` 分隔符，路径以 `-` 开头时必须这么写
 *   - `app.exe file:///C:/notes/a.md`  某些来源用 URL 传
 *   - 便携版启动器会把自己的 exe 路径也塞进 argv（见 release 的 NSIS 脚本），
 *     它不是 md，会被扩展名白名单挡掉。
 */
export function filesFromArgv(argv: string[]): string[] {
  const rest = argv.slice(1)
  const separator = rest.indexOf('--')
  const candidates = separator >= 0 ? rest.slice(separator + 1) : rest

  return candidates
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => {
      if (arg.startsWith('file://')) {
        try {
          return fileURLToPath(arg)
        } catch {
          return ''
        }
      }
      return arg
    })
    .filter((arg) => arg.length > 0)
    .filter((arg) => {
      try {
        return existsSync(arg) && statSync(arg).isFile()
      } catch {
        return false
      }
    })
    .filter(isMarkdownFile)
}
