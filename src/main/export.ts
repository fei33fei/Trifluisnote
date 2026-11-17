/**
 * 导出：HTML / PDF。
 *
 * PDF 不自研排版引擎，直接复用 Chromium 的 printToPDF：
 * 把渲染好的 HTML 丢进一个隐藏窗口打印成 PDF。
 * 这样导出的排版和编辑器里看到的一致，省掉一整套 PDF 排版代码。
 */

import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { THEME_CSS } from '../shared/theme-css'
import type { ExportPayload } from '../shared/types'

export type { ExportPayload }

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把正文片段包装成一份完整、可独立打开的 HTML。 */
export function buildExportHtml(payload: ExportPayload): string {
  return `<!doctype html>
<html lang="zh-CN" data-theme="${escapeHtml(payload.theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(payload.title)}</title>
<style>
html { background: var(--tfn-bg); }
html, body { margin: 0; padding: 0; }
body { padding: 48px 24px; }
.tfn-doc { max-width: 860px; margin: 0 auto; }
${THEME_CSS}
${payload.extraCss ?? ''}
@media print {
  body { padding: 0; }
  .tfn-doc { max-width: none; }
}
</style>
</head>
<body>
<article class="tfn-doc tfn-doc--static">${payload.html}</article>
</body>
</html>`
}

/** 生成 PDF 并返回 Buffer。 */
export async function renderPdf(payload: ExportPayload): Promise<Buffer> {
  const tmp = join(tmpdir(), `tfn-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  await writeFile(tmp, buildExportHtml(payload), 'utf8')

  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 1400,
    webPreferences: { offscreen: true, javascript: false, sandbox: true },
  })

  try {
    await win.loadFile(tmp)
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      landscape: false,
      preferCSSPageSize: false,
      generateTaggedPDF: true,
    })
    return data
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
