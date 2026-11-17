/**
 * 数学公式（KaTeX）。
 *
 * Milkdown 7 的 commonmark / gfm 预设里没有数学节点，所以这里自己写一套：
 *  - `remark-math` 负责 markdown 侧的解析与序列化（`$x$` / `$$x$$`）；
 *  - 两个 ProseMirror 节点（行内 / 块级）负责编辑器里的展示；
 *  - KaTeX 负责把 LaTeX 渲染成 HTML。
 *
 * 为什么公式节点是「原子」（atom）：
 *  行内公式一旦允许直接编辑内部文本，光标进出公式就会把 LaTeX 源码拆散，
 *  公式也就没法再被 KaTeX 正确渲染。所以这里把它当成一个整体：
 *  - 单击选中，Backspace 直接删除；
 *  - 双击打开编辑面板改 LaTeX 源码（见 renderer/MathDialog.tsx）。
 *
 * 源码模式里公式就是普通文本，想改直接改。
 */

import katex from 'katex'
import remarkMath from 'remark-math'
import { $inputRule, $node, $remark } from '@milkdown/kit/utils'
import { InputRule } from '@milkdown/prose/inputrules'
import { editorViewCtx } from '@milkdown/core'
import type { Editor } from '@milkdown/core'

/** 行内公式节点的类型名。 */
export const MATH_INLINE = 'math_inline'
/** 块级公式节点的类型名。 */
export const MATH_BLOCK = 'math_block'

/**
 * 把 LaTeX 渲染成 KaTeX 的 HTML。
 *
 * 渲染失败时不抛错，而是把源码原样显示出来 ——
 * 公式写错时用户还能看见自己写了什么，而不是整个编辑器崩掉。
 */
export function renderMathHtml(value: string, displayMode: boolean): string {
  try {
    return katex.renderToString(value, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: 'ignore',
    })
  } catch {
    return escapeHtml(value)
  }
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 造一个装 KaTeX 输出的元素。 */
function mathElement(value: string, displayMode: boolean): HTMLElement {
  const el = document.createElement(displayMode ? 'div' : 'span')
  el.className = displayMode ? 'tfn-math tfn-math--block' : 'tfn-math tfn-math--inline'
  if (displayMode) el.setAttribute('data-math-block', value)
  else el.setAttribute('data-math-inline', value)
  el.innerHTML = renderMathHtml(value, displayMode)
  return el
}

const mathInlineNode = $node(MATH_INLINE, () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    value: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'span[data-math-inline]',
      getAttrs: (dom) => ({
        value: (dom as HTMLElement).getAttribute('data-math-inline') ?? '',
      }),
    },
  ],
  toDOM: (node) => mathElement(String(node.attrs.value ?? ''), false),
  parseMarkdown: {
    match: ({ type }) => type === 'inlineMath',
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? '') })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === MATH_INLINE,
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, undefined, { value: String(node.attrs.value ?? '') })
    },
  },
}))

const mathBlockNode = $node(MATH_BLOCK, () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: {
    value: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'div[data-math-block]',
      getAttrs: (dom) => ({
        value: (dom as HTMLElement).getAttribute('data-math-block') ?? '',
      }),
    },
  ],
  toDOM: (node) => mathElement(String(node.attrs.value ?? ''), true),
  parseMarkdown: {
    match: ({ type }) => type === 'math',
    runner: (state, node, type) => {
      state.addNode(type, { value: String(node.value ?? '') })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === MATH_BLOCK,
    runner: (state, node) => {
      state.addNode('math', undefined, undefined, { value: String(node.attrs.value ?? '') })
    },
  },
}))

/**
 * 输入规则：敲完 `$x$` 变成行内公式，`$$x$$` 变成块级公式。
 *
 * 正则都带 `$` 结尾锚点 —— 输入规则的匹配对象是「光标前的整段文本」，
 * 只有锚在末尾才能保证匹配到的一定是刚刚敲完的那一段，
 * 不会误伤文中别处的美元符号。
 *
 * 块级规则要先注册：输入规则按注册顺序匹配，先匹配上的先生效。
 */
const mathBlockInputRule = $inputRule(
  () =>
    new InputRule(/^\$\$([^$]+)\$\$$/, (state, match) => {
      const type = state.schema.nodes[MATH_BLOCK]
      if (!type) return null
      const $from = state.selection.$from
      const depth = $from.depth
      if (depth === 0) return null
      // 整段替换：把当前段落换成块级公式节点
      const node = type.create({ value: match[1] ?? '' })
      return state.tr.replaceWith($from.before(depth), $from.end(depth), node)
    }),
)

const mathInlineInputRule = $inputRule(
  () =>
    new InputRule(/\$([^$\n]+)\$$/, (state, match, start, end) => {
      const type = state.schema.nodes[MATH_INLINE]
      if (!type) return null
      const node = type.create({ value: match[1] ?? '' })
      return state.tr.replaceWith(start, end, node)
    }),
)

/** 数学相关插件集合。 */
export function mathPlugin() {
  return [
    // $remark 返回的是 [配置 ctx, 插件] 二元组，要摊平后再交给 use()
    ...$remark('remarkMath', () => remarkMath),
    mathInlineNode,
    mathBlockNode,
    mathBlockInputRule,
    mathInlineInputRule,
  ]
}

/* ------------------------------------------------------------------ */
/* 编辑公式                                                              */
/* ------------------------------------------------------------------ */

/** 一个数学节点的位置与当前源码。 */
export interface MathNodeRef {
  /** 节点在文档中的位置（节点自身之前） */
  pos: number
  value: string
  isBlock: boolean
}

/**
 * 找到某个 DOM 元素对应的数学节点。
 *
 * 双击公式时，渲染层拿到的是 DOM 元素；
 * 这里用 `posAtDOM` 反查它在文档里的位置，再取节点。
 */
export function findMathByElement(editor: Editor, el: Element): MathNodeRef | null {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (!view) return null

    let pos: number | null = null
    try {
      pos = view.posAtDOM(el, 0)
    } catch {
      pos = null
    }
    if (pos == null) return null

    // posAtDOM 给的是节点之前的位置；取不到就往后再挪一格试试
    for (const candidate of [pos, pos + 1]) {
      const node = view.state.doc.nodeAt(candidate)
      if (!node) continue
      if (node.type.name === MATH_INLINE || node.type.name === MATH_BLOCK) {
        return {
          pos: candidate,
          value: String(node.attrs.value ?? ''),
          isBlock: node.type.name === MATH_BLOCK,
        }
      }
    }
    return null
  })
}

/** 改写一个数学节点的 LaTeX 源码。 */
export function setMathValue(editor: Editor, pos: number, value: string): void {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (!view) return
    const node = view.state.doc.nodeAt(pos)
    if (!node) return
    if (node.type.name !== MATH_INLINE && node.type.name !== MATH_BLOCK) return
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value }).scrollIntoView(),
    )
    view.focus()
  })
}
