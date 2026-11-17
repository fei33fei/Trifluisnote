/**
 * 图片落盘（主进程侧）。
 *
 * v0.2 的图片策略：
 *  - 粘贴 / 拖入的图片写到「文档旁边的 assets/」，markdown 里写相对路径
 *    （`assets/xxx.png`）—— 这样文档连同图片目录一起拷走还能用；
 *  - 未命名文档还没有目录，就先写到应用数据目录，markdown 里写绝对路径；
 *    等用户「另存为」时再把图片搬到新目录并改写成相对路径；
 *  - 导出 HTML 时把本地图片转成 data URI，导出的单文件可以独立打开。
 *
 * 纯逻辑（路径识别、改写、内嵌）在 ./embed.ts 里，那部分不依赖 Electron。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'
import type { ImageSaveRequest, ImageSaveResult } from '../shared/types'
import { sanitizeImageName, toPosix, uniquePath } from './embed'

export { embedLocalImages, localPathOf, migrateImages } from './embed'

/** 文档旁边的图片目录。 */
export function imagesDir(docPath: string | null): string {
  if (docPath) return join(dirname(docPath), 'assets')
  return join(app.getPath('userData'), 'images')
}

/**
 * 某个文档所在目录的 file:// 基础地址。
 *
 * 渲染层用它把 markdown 里的相对图片路径解析成可显示的 URL：
 * `new URL('assets/a.png', baseUrl)`。
 */
export function baseUrlFor(docPath: string | null): string {
  const dir = docPath ? dirname(docPath) : app.getPath('userData')
  const href = pathToFileURL(dir).href
  return href.replace(/\/+$/, '') + '/'
}

/** 保存一张粘贴进来的图片。 */
export async function saveImage(request: ImageSaveRequest): Promise<ImageSaveResult> {
  try {
    const dir = imagesDir(request.docPath)
    await mkdir(dir, { recursive: true })

    const name = sanitizeImageName(request.fileName)
    const target = await uniquePath(dir, name)
    await writeFile(target, Buffer.from(request.data, 'base64'))

    const path = request.docPath
      ? toPosix(relative(dirname(request.docPath), target))
      : toPosix(target)

    return { ok: true, path, absolutePath: target }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
