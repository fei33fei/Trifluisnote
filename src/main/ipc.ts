import { existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ExportPayload, ExportResult, OpenResult, SaveResult } from '../shared/types'
import { THEMES } from '../shared/theme-css'
import { buildExportHtml, renderPdf } from './export'
import { createWindow, getDocState, patchDocState } from './windows'

/** Markdown 文件扩展名白名单。 */
const MD_EXT = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt']

function isMarkdownFile(filePath: string): boolean {
  return MD_EXT.includes(extname(filePath).toLowerCase())
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
    try {
      const content = await readFile(filePath, 'utf8')
      patchDocState(win, { filePath, dirty: false, title: basename(filePath) })
      win.setTitle(`${basename(filePath)} — Trifluisnote`)
      return { ok: true, filePath, content }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('file:save', async (event, filePath: string, content: string): Promise<SaveResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { ok: false, error: 'no-window' }
    try {
      await writeFile(filePath, content, 'utf8')
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
      await writeFile(result.filePath, content, 'utf8')
      patchDocState(win, { filePath: result.filePath, dirty: false, title: basename(result.filePath) })
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

/** 命令行传入的文件路径（双击 .md 文件时由系统传入）。 */
export function filesFromArgv(argv: string[]): string[] {
  return argv
    .slice(1)
    .filter((arg) => !arg.startsWith('-'))
    .filter((arg) => {
      try {
        return existsSync(arg) && statSync(arg).isFile()
      } catch {
        return false
      }
    })
    .filter(isMarkdownFile)
}
