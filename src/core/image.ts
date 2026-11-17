/**
 * 图片节点（覆盖 commonmark 预设里的同名节点）。
 *
 * 为什么要覆盖：
 *  - 预设的 image 节点把 `src` 原样写进 DOM，相对路径在编辑器里必然显示不出来
 *    （编辑器跑在 app:// 或 file:// 下，相对路径的基准根本不是文档所在目录）；
 *  - v0.2 要求粘贴进来的图片**落盘**到文档旁边的 `assets/`，markdown 里写相对路径。
 *
 * 于是这里重写 image 节点：
 *  - 模型里的 `src` 始终是「markdown 里该写的样子」（相对路径或绝对路径）；
 *  - 渲染到 DOM 时才把它解析成可显示的 URL（file:// 绝对地址）。
 *
 * 这样序列化出来的 markdown 永远是干净的相对路径，
 * 而编辑器里又能正常显示图片；导出 HTML 时再把本地图片内嵌成 data URI。
 *
 * `$node` 用的是 upsert 语义（同 id 后注册覆盖先注册），
 * 所以这个节点会顶掉 preset-commonmark 里的 image。
 */

import { $node } from '@milkdown/kit/utils'
import type { Uploader } from '@milkdown/kit/plugin/upload'
import type { Node as ProseNode, Schema } from '@milkdown/prose/model'

/** 把 markdown 里的图片路径解析成可显示的 URL。 */
export type ImageResolver = (src: string) => string

/**
 * 路径 → 显示用 URL。
 *
 * - `http(s):` / `data:` / `file:` 原样返回；
 * - 绝对路径（`C:/x.png`）转成 file:// 地址；
 * - 相对路径按文档所在目录（baseUrl）解析。
 */
export function resolveImageSrc(src: string, baseUrl: string): string {
  if (!src) return ''
  if (/^(https?:|data:|blob:|file:)/i.test(src)) return src

  const normalized = src.replace(/\\/g, '/')

  // 绝对路径（Windows 盘符或 POSIX 根目录）
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('/')) {
    const parts = normalized.split('/')
    const drive = /^[a-zA-Z]:$/.test(parts[0] ?? '') ? parts[0] : null
    const rest = drive ? parts.slice(1) : parts
    const encoded = rest.map((seg) => encodeURIComponent(seg)).join('/')
    return 'file:///' + (drive ? `${drive}/` : '') + encoded
  }

  if (!baseUrl) return src
  try {
    return new URL(normalized, baseUrl).href
  } catch {
    return src
  }
}

/** 图片节点（覆盖预设实现）。 */
export function imagePlugin(resolve: ImageResolver) {
  return $node('image', () => ({
    inline: true,
    group: 'inline',
    selectable: true,
    draggable: true,
    marks: '',
    atom: true,
    defining: true,
    isolating: true,
    attrs: {
      src: { default: '', validate: 'string' },
      alt: { default: '', validate: 'string' },
      title: { default: '', validate: 'string' },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement
          return {
            src: el.getAttribute('src') ?? '',
            alt: el.getAttribute('alt') ?? '',
            title: el.getAttribute('title') ?? '',
          }
        },
      },
    ],
    toDOM: (node) => [
      'img',
      {
        src: resolve(String(node.attrs.src ?? '')),
        alt: String(node.attrs.alt ?? ''),
        title: String(node.attrs.title ?? ''),
      },
    ],
    parseMarkdown: {
      match: ({ type }) => type === 'image',
      runner: (state, node, type) => {
        state.addNode(type, {
          src: String(node.url ?? ''),
          alt: String(node.alt ?? ''),
          title: String(node.title ?? ''),
        })
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'image',
      runner: (state, node) => {
        state.addNode('image', undefined, undefined, {
          title: String(node.attrs.title ?? ''),
          url: String(node.attrs.src ?? ''),
          alt: String(node.attrs.alt ?? ''),
        })
      },
    },
  }))
}

/** 读文件为纯 base64（不带 data: 前缀）。 */
async function readAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export interface ImageUploaderOptions {
  /**
   * 把一张图片写到磁盘，返回 markdown 里该写的路径。
   * 由渲染层实现（要走主进程落盘）。
   */
  save: (fileName: string, data: string) => Promise<string | null>
}

/**
 * 粘贴 / 拖入图片时的落盘器。
 *
 * Milkdown 的 upload 插件把文件交给我们，我们落盘后返回 image 节点，
 * 节点里的 src 就是相对路径 —— 于是 markdown 里得到的是
 * `![](assets/xxx.png)`，文档连同 assets 目录一起拷走还能用。
 */
export function createImageUploader(options: ImageUploaderOptions): Uploader {
  return async (files: FileList, schema: Schema) => {
    const type = schema.nodes['image']
    if (!type) return []

    const nodes: ProseNode[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      try {
        const data = await readAsBase64(file)
        const path = await options.save(file.name || 'image.png', data)
        if (!path) continue
        nodes.push(
          type.create({
            src: path,
            alt: file.name.replace(/\.[^.]+$/, ''),
            title: '',
          }),
        )
      } catch {
        /* 单张图片失败不应该影响整次粘贴 */
      }
    }
    return nodes
  }
}
