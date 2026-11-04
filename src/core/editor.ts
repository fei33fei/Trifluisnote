/**
 * Trifluisnote 编辑器核心层。
 *
 * 设计约束（与 Typora 逆向结论对应）：
 *  - 本模块不依赖 Electron、不依赖 React，只依赖 Milkdown/ProseMirror；
 *  - 对外暴露的是「用户意图」而非「按键」，对应 Typora 的 UserOp 层；
 *  - 序列化走 remark，解析走 mdast → ProseMirror doc，两者共用同一 schema；
 *  - 全部使用 Milkdown 官方宏（@milkdown/utils），不自行拼装 ProseMirror 事务。
 */

import {
  Editor,
  defaultValueCtx,
  editorStateCtx,
  editorViewCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  schemaCtx,
} from '@milkdown/core'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { redoCommand, undoCommand, history } from '@milkdown/kit/plugin/history'
import { indent } from '@milkdown/kit/plugin/indent'
import { trailing } from '@milkdown/kit/plugin/trailing'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { upload } from '@milkdown/kit/plugin/upload'
import { commonmark } from '@milkdown/preset-commonmark'
import { gfm } from '@milkdown/preset-gfm'
import { callCommand, getMarkdown, replaceAll } from '@milkdown/kit/utils'
import { DOMSerializer } from '@milkdown/prose/model'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { codeHighlightPlugin } from './highlight'
import { taskListPlugin } from './task-list'

export interface CoreEditorOptions {
  /** 初始 markdown 内容 */
  defaultValue: string
}

/**
 * 组装一套完整的编辑器配置。
 *
 * 插件顺序有讲究：
 *  - listener/history 必须在 commonmark 之前，保证订阅在 schema 就绪后生效；
 *  - gfm 依赖 commonmark 的基础节点；
 *  - codeHighlightPlugin 放在最后，它只是往文档上投影 decoration，不改 schema。
 */
export function buildEditorFactory(options: CoreEditorOptions) {
  return (root: HTMLElement) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, options.defaultValue)

        /**
         * Markdown 输出风格。
         *
         * remark-stringify 默认用 `*` 作为无序列表符号，而绝大多数
         * Markdown 文件（含 Typora 保存出来的）用 `-`。不统一的话，
         * 用户打开 `- [ ] xxx` 的文件再保存，就会被改写成 `* [ ] xxx`，
         * 造成无意义的 diff。
         *
         * ⚠ 这里必须改 `remarkStringifyOptionsCtx`，而不是 remark 插件的
         * `data('toMarkdown', ...)`：remark-stringify v11 的 compiler 是
         *
         *     toMarkdown(tree, { ...self.data('settings'), ...options, ... })
         *
         * `options` 排在 `data('settings')` 之后（优先级更高），而 Milkdown
         * 创建 processor 时恰好把 `remarkStringifyOptionsCtx` 当作 options
         * 传了进去，所以走 `data()` 那条路根本不会生效。
         *
         * 时序：init 插件 `await ctx.waitTimers([ConfigReady])` 之后才读取
         * 这份 options，而 config 阶段正好在 ConfigReady 之前完成，所以
         * 在 config 里更新是安全的。
         */
        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          bullet: '-' as const,
          listItemIndent: 'one' as const,
        }))
      })
      .use(listener)
      .use(history)
      .use(commonmark)
      .use(gfm)
      .use(indent)
      .use(trailing)
      .use(clipboard)
      .use(upload)
      .use(codeHighlightPlugin())
      .use(taskListPlugin())
}

export function createCoreEditor(root: HTMLElement, defaultValue: string): Editor {
  return buildEditorFactory({ defaultValue })(root)
}

/** 把当前文档序列化成 markdown。 */
export function readMarkdown(editor: Editor): string {
  return editor.action(getMarkdown())
}

/** 用新的 markdown 替换整个文档（源码模式切回所见即所得时使用）。 */
export function writeMarkdown(editor: Editor, markdown: string): void {
  editor.action(replaceAll(markdown))
}

/**
 * 订阅文档变化。
 * 注意：listener 插件在装载时会注入新的 ListenerManager，
 * 因此必须在 editor 创建完成之后再订阅，不能在 config 阶段挂。
 */
export function onMarkdownChange(editor: Editor, callback: (markdown: string) => void): void {
  editor.ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => callback(markdown))
}

/** 撤销 / 重做。 */
export function undo(editor: Editor): void {
  editor.action(callCommand(undoCommand.key))
}

export function redo(editor: Editor): void {
  editor.action(callCommand(redoCommand.key))
}

/** 纯文本统计（字数 / 字符）。中日韩按字计，其余按空白分词。 */
export function countStats(text: string): { words: number; chars: number } {
  const chars = text.length
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? []).length
  const latin = text
    .replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
  return { words: cjk + latin, chars }
}

/** 当前文档统计（字数 / 字符）。 */
export function readStats(editor: Editor): { words: number; chars: number } {
  return countStats(readPlainText(editor))
}

/**
 * 把当前文档渲染成 HTML 片段（用于导出）。
 *
 * 走 schema 的 DOMSerializer，而不是直接抓编辑器 DOM：
 * 后者会带上 ProseMirror 的光标装饰、widget 等内部节点。
 */
export function readRenderedHtml(editor: Editor): string {
  return editor.action((ctx) => {
    const doc = ctx.get(editorStateCtx).doc
    const schema = ctx.get(schemaCtx)
    const serializer = DOMSerializer.fromSchema(schema)
    const holder = document.createElement('div')
    holder.appendChild(serializer.serializeFragment(doc.content))
    return holder.innerHTML
  })
}

/** 读取纯文本（导出 TXT 用）。 */
export function readPlainText(editor: Editor): string {
  return editor.action((ctx) => {
    const doc = ctx.get(editorStateCtx).doc
    return doc.textBetween(0, doc.content.size, '\n', '\n')
  })
}

/* ------------------------------------------------------------------ */
/* 查找 / 替换                                                          */
/* ------------------------------------------------------------------ */

export interface FindMatch {
  from: number
  to: number
}

/**
 * 在文档中查找所有匹配。
 *
 * 直接遍历文本节点而不是用 `textBetween` 的线性索引：
 * 前者在 inline 标记边界（粗体/斜体）处天然断开，位置是精确的文档坐标，
 * 不会出现「换行符算不算一个字符」的偏移歧义。
 */
export function findMatches(editor: Editor, needle: string, caseSensitive: boolean): FindMatch[] {
  if (!needle) return []
  return editor.action((ctx) => {
    const doc = ctx.get(editorStateCtx).doc
    const hits: FindMatch[] = []
    const target = caseSensitive ? needle : needle.toLowerCase()

    doc.descendants((node, pos) => {
      if (!node.isText) return true
      const text = node.text ?? ''
      const hay = caseSensitive ? text : text.toLowerCase()
      let i = 0
      while (i <= hay.length - target.length) {
        if (hay.startsWith(target, i)) {
          hits.push({ from: pos + i, to: pos + i + target.length })
          i += target.length
        } else {
          i++
        }
      }
      return false
    })

    return hits
  })
}

/** 把第 n 个匹配选中并滚动到可见区域。 */
export function selectMatch(editor: Editor, match: FindMatch): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (!view) return
    const { state, dispatch } = view
    const from = Math.min(match.from, state.doc.content.size)
    const to = Math.min(match.to, state.doc.content.size)
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView())
    view.focus()
  })
}

/** 替换当前选区内容。 */
export function replaceSelection(editor: Editor, replacement: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (!view) return
    const { state, dispatch } = view
    dispatch(state.tr.insertText(replacement).scrollIntoView())
    view.focus()
  })
}

/**
 * 全部替换。
 *
 * 从后往前替换，避免前面的替换改变后面的位置。
 */
export function replaceAllMatches(editor: Editor, matches: FindMatch[], replacement: string): number {
  if (!matches.length) return 0
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (!view) return 0
    const { state, dispatch } = view
    let tr = state.tr
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]
      tr = tr.insertText(replacement, m.from, m.to)
    }
    dispatch(tr.scrollIntoView())
    view.focus()
    return matches.length
  })
}

/* ------------------------------------------------------------------ */
/* 留白点击落光标                                                        */
/* ------------------------------------------------------------------ */

/** 一个可编辑块（段落 / 标题 / 列表项段落 / 代码块）在文档里的位置与屏幕矩形。 */
interface EditableBlock {
  /** 块内第一个合法文本位置 */
  start: number
  /** 块内最后一个合法文本位置 */
  end: number
  rect: DOMRect
}

/**
 * 收集文档里所有可编辑块（textblock）。
 *
 * `descendants` 给出的 pos 是「节点之前的位置」，
 * 所以块内文本的合法区间是 [pos+1, pos+1+content.size]。
 */
function collectEditableBlocks(view: EditorView): EditableBlock[] {
  const blocks: EditableBlock[] = []
  view.state.doc.descendants((node: ProseNode, pos: number) => {
    if (!node.isTextblock) return true
    const dom = view.nodeDOM(pos)
    if (!(dom instanceof HTMLElement)) return true
    const start = pos + 1
    blocks.push({
      start,
      end: start + node.content.size,
      rect: dom.getBoundingClientRect(),
    })
    return true
  })
  return blocks
}

/**
 * 把屏幕坐标换算成文档位置。
 *
 * Typora 的交互是：正文左右两侧的留白、正文下方的空白都属于「可点击区」，
 * 点下去光标落到最近的一行，而不是「点了什么也没发生」。
 *
 * ProseMirror 只处理 contenteditable 内部的事件，留白在它外面，
 * 所以这里自己算：
 *  1. 先用浏览器自带的命中测试（能精确到字符，优先用）；
 *  2. 拿不到就退回到「最近的可编辑块」——按垂直距离选块，
 *     再按左右决定落在块首还是块尾。
 */
export function positionAtPoint(view: EditorView, x: number, y: number): number | null {
  const { state } = view

  // 1) 浏览器命中测试：点在正文行上时能精确到字符
  let native: { pos: number } | null = null
  try {
    native = view.posAtCoords({ left: x, top: y })
  } catch {
    // 命中测试偶尔会在文档结构变化的那一帧抛错，忽略，走下面的兜底
    native = null
  }
  if (native && native.pos >= 0 && native.pos <= state.doc.content.size) {
    const $pos = state.doc.resolve(native.pos)
    if ($pos.parent.isTextblock) return native.pos
  }

  // 2) 退回到「最近的可编辑块」
  const blocks = collectEditableBlocks(view)
  if (!blocks.length) return null

  let best = blocks[0]
  let bestDist = Number.POSITIVE_INFINITY
  for (const block of blocks) {
    const dist =
      y < block.rect.top ? block.rect.top - y : y > block.rect.bottom ? y - block.rect.bottom : 0
    if (dist < bestDist) {
      bestDist = dist
      best = block
    }
  }

  // 点在块的下方 → 落到该块末尾（也就是这一行的行尾）
  if (y > best.rect.bottom) return best.end
  // 点在块的上方 → 落到该块开头
  if (y < best.rect.top) return best.start
  // 垂直上落在块内：靠左 → 行首，靠右 → 行尾
  return x <= best.rect.left ? best.start : best.end
}

/**
 * 把光标放到指定屏幕坐标处（用于正文之外的留白点击）。
 *
 * 返回是否成功落点。
 */
export function placeCaretAtPoint(view: EditorView, x: number, y: number): boolean {
  const { state } = view
  const pos = positionAtPoint(view, x, y)
  if (pos == null) return false
  const $pos = state.doc.resolve(pos)
  if (!$pos.parent.isTextblock) return false
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)))
  view.focus()
  return true
}
