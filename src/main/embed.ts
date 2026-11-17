/**
 * 本地图片与 markdown 的互转（纯函数，不依赖 Electron）。
 *
 * 单独拆出来有两个原因：
 *  - 这些逻辑（路径识别、正则改写、base64 内嵌）不依赖主进程的任何状态，
 *    拆出来才能单独跑测试；
 *  - 主进程里 `app.getPath` 之类的调用会让纯逻辑没法在 node 里直接跑。
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'

/** 认得的图片扩展名（决定 MIME 与 base64 编码方式）。 */
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
}

/** 去掉路径里可能带目录的部分，并清掉危险字符。 */
export function sanitizeImageName(name: string): string {
  const base = basename(name).replace(/[\\/:*?"<>|]/g, '_').trim()
  return base || 'image.png'
}

/** 把路径里的反斜杠换成正斜杠（markdown 里统一用正斜杠）。 */
export function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/** 判断一个 URL 是不是「本地文件」。 */
export function isLocalUrl(url: string): boolean {
  if (!url) return false
  if (/^(https?:|data:|blob:|mailto:)/i.test(url)) return false
  return true
}

/** 把本地路径 / file:// URL 还原成磁盘路径。 */
export function localPathOf(url: string): string | null {
  if (!url) return null
  if (url.startsWith('file://')) {
    try {
      const pathname = decodeURIComponent(new URL(url).pathname)
      // file:///C:/x.png → C:/x.png
      return /^\/[a-zA-Z]:/.test(pathname) ? pathname.slice(1) : pathname
    } catch {
      return null
    }
  }
  if (/^[a-zA-Z]:[\\/]/.test(url)) return url
  if (url.startsWith('/') && !url.startsWith('//')) return url
  return null
}

/**
 * 把 markdown 里指向本地的图片路径改写成相对路径，并把图片搬到新目录。
 *
 * 「另存为」时调用：原来未命名文档写的是绝对路径，
 * 存到新位置后应该变成 `assets/xxx.png`，文档才能自洽。
 */
export async function migrateImages(content: string, targetPath: string): Promise<string> {
  const targetDir = dirname(targetPath)
  const assetsDir = join(targetDir, 'assets')
  // 分组：1 = alt，2 = URL，3 = 标题等尾巴
  const pattern = /!\[([^\]]*)\]\((<[^>]*>|[^)\s]+)((?:\s+["'][^"']*["'])?)\)/g

  const replaced = new Map<string, string>()
  const found = Array.from(content.matchAll(pattern))
  for (const match of found) {
    const raw = match[2] ?? ''
    const url = raw.startsWith('<') ? raw.slice(1, -1) : raw
    if (!isLocalUrl(url)) continue
    const abs = localPathOf(url)
    if (!abs || !existsSync(abs)) continue
    try {
      await mkdir(assetsDir, { recursive: true })
      const name = sanitizeImageName(basename(abs))
      const target = await uniquePath(assetsDir, name)
      await copyFile(abs, target)
      replaced.set(url, toPosix(relative(targetDir, target)))
    } catch {
      /* 搬不动就保持原样 */
    }
  }

  if (!replaced.size) return content
  return content.replace(pattern, (full, alt: string, raw: string, tail: string) => {
    const url = raw.startsWith('<') ? raw.slice(1, -1) : raw
    const moved = replaced.get(url)
    return moved ? `![${alt}](${moved}${tail ?? ''})` : full
  })
}

/** 目标已存在时加序号：a.png → a-1.png → a-2.png */
export async function uniquePath(dir: string, name: string): Promise<string> {
  let candidate = join(dir, name)
  if (!existsSync(candidate)) return candidate
  const ext = extname(name)
  const stem = basename(name, ext)
  for (let i = 1; i < 1000; i++) {
    candidate = join(dir, `${stem}-${i}${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  return join(dir, `${stem}-${Date.now()}${ext}`)
}

/**
 * 把导出 HTML 里的本地图片换成 data URI。
 *
 * 导出的 HTML 要能单独发给别人，所以相对路径 / 本地绝对路径都不能留，
 * 只能把图片本体塞进去。
 */
export async function embedLocalImages(html: string, baseDir: string | null): Promise<string> {
  const pattern = /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi
  const matches = Array.from(html.matchAll(pattern))
  if (!matches.length) return html

  const replacements = new Map<string, string>()
  for (const match of matches) {
    const url = match[2] ?? ''
    if (!isLocalUrl(url)) continue
    if (replacements.has(url)) continue

    const abs = localPathOf(url) ?? (baseDir ? join(baseDir, url) : null)
    if (!abs || !existsSync(abs)) continue
    try {
      const buf = await readFile(abs)
      const mime = MIME_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream'
      replacements.set(url, `data:${mime};base64,${buf.toString('base64')}`)
    } catch {
      /* 读不到就保持原样 */
    }
  }

  if (!replacements.size) return html
  return html.replace(pattern, (full, head: string, url: string, tail: string) => {
    const data = replacements.get(url)
    return data ? `${head}${data}${tail}` : full
  })
}
