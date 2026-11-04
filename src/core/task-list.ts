/**
 * GFM 任务列表的可交互复选框。
 *
 * 背景：`@milkdown/preset-gfm` 的 `list_item` 扩展只把 `[x]` / `[ ]` 解析成
 * `checked` 属性，并输出 `<li data-item-type="task" data-checked="true">`，
 * **不自带复选框控件**（官方控件在 Milkdown 的 Vue 组件层里，
 * 代价是引入 Vue + 与本项目自有 CSS 体系冲突）。
 *
 * 这里用 ProseMirror 的 widget decoration 在列表项起始处插入一个可点击控件：
 *  - widget 不进入文档模型，所以源码模式的往返完全无损；
 *  - 点击时用 `setNodeMarkup` 改写 `checked` 属性，undo/redo 天然可用；
 *  - `contenteditable=false` 让 ProseMirror 不会把选区挪进这个控件。
 *
 * ⚠ 两个必须绕开的坑：
 *
 * 1. 为什么不用真正的 `<input type="checkbox">`？
 *    HTML 规范规定复选框的 checkedness 在 click 事件的**派发前**翻转
 *    （真实点击），事件被取消则回滚；而合成的 `el.click()` 走的是
 *    activation behavior，翻转发生在**派发之后**。两者时序不同，
 *    我们无法在 handler 里可靠地控制最终显示值 —— 表现就是
 *    「点了没反应」。所以这里用 `<span role="checkbox">`，
 *    显示完全由文档模型推导，不受原生控件行为干扰。
 *
 * 2. 为什么不能给 widget 随便加 `spec.key`？
 *    ProseMirror 的 `WidgetType.eq()` 在 `spec.key` 相等时直接判等
 *    （见 prosemirror-view `class WidgetType`）：
 *
 *        eq(other) {
 *          return this == other ||
 *            (other instanceof WidgetType &&
 *             (this.spec.key && this.spec.key == other.spec.key ||
 *              this.toDOM == other.toDOM && compareObjs(this.spec, other.spec)))
 *        }
 *
 *    也就是说只要 key 相同，视图层就会**复用旧的 DOM 元素**，
 *    于是旧元素上绑定的闭包还持有过期的 `pos` / `attrs`。
 *
 *    因此这里采用「元素池 + 手动刷新」策略：
 *    - 元素按「文档中第几个任务项」索引复用，避免每次输入都重建 DOM；
 *    - 每次重建装饰集都手动刷新显示文本与 `aria-checked`；
 *    - 点击时从 `data-pos` 反查**当前** state 里的节点，不依赖闭包快照。
 */

import { Plugin, PluginKey } from '@milkdown/prose/state'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import type { EditorView } from '@milkdown/prose/view'
import type { Node as PMNode } from '@milkdown/prose/model'
import { $prose } from '@milkdown/utils'

const KEY = new PluginKey<DecorationSet>('trifluisnote-task-list')

const BOX_UNCHECKED = '☐'
const BOX_CHECKED = '☑'

interface TaskItem {
  /** list_item 节点自身的位置（位于其父节点之前） */
  pos: number
  /** 是否已勾选 */
  checked: boolean
  /** 复选框 widget 的插入位置 */
  widgetPos: number
}

export function taskListPlugin() {
  return $prose(() => {
    let view: EditorView | null = null

    /** 复选框 DOM 元素池：索引 = 文档中第几个任务项。 */
    const pool = new Map<number, HTMLElement>()

    /** 切换某个任务项的勾选状态（以当前 state 为准）。 */
    const toggle = (el: HTMLElement): void => {
      if (!view) return

      const pos = Number(el.getAttribute('data-pos'))
      if (!Number.isFinite(pos)) return

      // 从当前 state 反查节点，避免闭包里的 pos / attrs 过期
      const node = view.state.doc.nodeAt(pos)
      if (!node || node.type.name !== 'list_item') return

      const next = !Boolean(node.attrs.checked)
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        checked: next,
      })
      view.dispatch(tr)
      view.focus()
    }

    const createCheckbox = (): HTMLElement => {
      const span = document.createElement('span')
      span.className = 'tfn-task__checkbox'
      span.setAttribute('role', 'checkbox')
      span.setAttribute('tabindex', '0')
      span.setAttribute('aria-label', '任务项')
      span.contentEditable = 'false'

      // 阻止 mousedown 的默认行为：避免 ProseMirror 把选区挪到控件上，
      // 也避免浏览器把焦点从正文抢走。
      span.addEventListener('mousedown', (event) => {
        event.preventDefault()
      })

      span.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggle(span)
      })

      span.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          toggle(span)
        }
      })

      return span
    }

    /** 扫描文档里所有任务项。 */
    const collect = (doc: PMNode): TaskItem[] => {
      const items: TaskItem[] = []
      doc.descendants((node, pos) => {
        if (node.type.name !== 'list_item') return true
        const checked = node.attrs.checked as boolean | null | undefined
        if (checked === null || checked === undefined) return true
        // list_item 的内容形如 `paragraph block*`，
        // 段落的文本从 pos + 2 开始；万一没有段落则退回 pos + 1。
        const first = node.firstChild
        const widgetPos = pos + (first && first.isTextblock ? 2 : 1)
        items.push({ pos, checked: Boolean(checked), widgetPos })
        return true
      })
      return items
    }

    const build = (doc: PMNode): DecorationSet => {
      const items = collect(doc)
      const decos: Decoration[] = []

      items.forEach((item, index) => {
        let el = pool.get(index)
        if (!el) {
          el = createCheckbox()
          pool.set(index, el)
        }
        // 手动刷新：DOM 元素会被视图层复用，这里必须自己同步显示状态。
        el.textContent = item.checked ? BOX_CHECKED : BOX_UNCHECKED
        el.setAttribute('aria-checked', String(item.checked))
        el.setAttribute('data-pos', String(item.pos))
        decos.push(
          Decoration.widget(item.widgetPos, el, { side: -1, key: `tfn-task-${index}` }),
        )
      })

      for (const key of Array.from(pool.keys())) {
        if (key >= items.length) pool.delete(key)
      }

      return DecorationSet.create(doc, decos)
    }

    return new Plugin<DecorationSet>({
      key: KEY,
      view: (v) => {
        view = v
        return {
          destroy() {
            view = null
            pool.clear()
          },
        }
      },
      state: {
        init: (_config, state) => build(state.doc),
        apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
      },
      props: {
        decorations(state) {
          return KEY.getState(state)
        },
      },
    })
  })
}
