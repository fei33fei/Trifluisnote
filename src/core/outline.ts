/**
 * 大纲（Outline）提取。
 *
 * 大纲是从文档的标题节点实时推导出来的，
 * 这里同样直接从 ProseMirror 文档树读取，不另存一份索引——
 * 文档变了，大纲自然跟着变。
 */

import { editorStateCtx, editorViewCtx } from '@milkdown/core'
import type { Editor } from '@milkdown/core'
import { TextSelection } from '@milkdown/prose/state'

export interface OutlineItem {
  /** 标题级别 1..6 */
  level: number
  /** 标题文本 */
  text: string
  /** 标题在文档中的位置（用于点击跳转） */
  pos: number
  /** 是否为当前光标所在的标题 */
  active: boolean
}

/** 读取当前文档的大纲。 */
export function readOutline(editor: Editor): OutlineItem[] {
  return editor.action((ctx) => {
    const state = ctx.get(editorStateCtx)
    const doc = state.doc
    const head = state.selection.head

    const items: OutlineItem[] = []
    doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return true
      const level = typeof node.attrs.level === 'number' ? node.attrs.level : 1
      items.push({
        level,
        text: node.textContent,
        pos: pos + 1,
        active: false,
      })
      return false
    })

    // 标记光标所在的那个标题：光标落在标题节点范围内
    for (const item of items) {
      const node = doc.nodeAt(item.pos)
      if (node && head >= item.pos && head <= item.pos + node.nodeSize) {
        item.active = true
        break
      }
    }

    return items
  })
}

/** 把光标移动到指定大纲项。 */
export function jumpToOutline(editor: Editor, pos: number): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (!view) return
    const { state, dispatch } = view
    const selection = TextSelection.near(state.doc.resolve(pos))
    dispatch(state.tr.setSelection(selection).scrollIntoView())
    view.focus()
  })
}
