import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor, editorViewCtx } from '@milkdown/core'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import type { Uploader } from '@milkdown/kit/plugin/upload'
import {
  buildEditorFactory,
  countStats,
  findMatches,
  onMarkdownChange,
  placeCaretAtPoint,
  readMarkdown,
  readRenderedHtml,
  readStats,
  redo,
  replaceAllMatches,
  replaceSelection,
  selectMatch,
  undo,
  writeMarkdown,
} from '../core/editor'
import type { FindMatch } from '../core/editor'
import { findMathByElement, setMathValue } from '../core/math'
import type { MathNodeRef } from '../core/math'
import { jumpToOutline, readOutline } from '../core/outline'
import type { OutlineItem } from '../core/outline'

export type ViewMode = 'wysiwyg' | 'source'

export interface EditorApi {
  getMarkdown: () => string
  setMarkdown: (markdown: string) => void
  getRenderedHtml: () => string
  undo: () => void
  redo: () => void
  focus: () => void
  /** 读取大纲 */
  getOutline: () => OutlineItem[]
  /** 跳到大纲项 */
  goToOutline: (pos: number) => void
  /** 查找 */
  find: (needle: string, caseSensitive: boolean) => FindMatch[]
  /** 选中某个匹配 */
  selectMatch: (match: FindMatch) => void
  /** 替换当前选区 */
  replaceSelection: (text: string) => void
  /** 全部替换 */
  replaceAll: (matches: FindMatch[], text: string) => number
  /** 找到 DOM 元素对应的公式节点 */
  findMath: (el: Element) => MathNodeRef | null
  /** 改写公式源码 */
  setMathValue: (pos: number, value: string) => void
}

export interface EditorPaneProps {
  /** 标签页 id（多标签页下每个标签页一个独立编辑器实例） */
  tabId: string
  /** 编辑器创建时的初始内容 */
  defaultContent: string
  /** 是否为当前激活的标签页 */
  visible: boolean
  mode: ViewMode
  /** 把 markdown 里的图片路径解析成可显示的 URL */
  resolveImage: (src: string) => string
  /** 粘贴 / 拖入图片时的落盘器 */
  uploader: Uploader
  /** 编辑器内容发生变化（防抖 200ms 后触发） */
  onChange: (markdown: string) => void
  /** 编辑器就绪、初始内容已应用完成，回调应用后的规范化 markdown */
  onApplied?: (markdown: string) => void
  onStats: (stats: { words: number; chars: number }) => void
  onOutline: (items: OutlineItem[]) => void
  onReady: (api: EditorApi) => void
  /** 双击公式：交给上层弹编辑框 */
  onMathEdit: (ref: MathNodeRef) => void
}

/**
 * Milkdown 的 React 集成要求 useEditor 与 <Milkdown /> 同处一个
 * MilkdownProvider 下：useEditor 负责注册工厂，<Milkdown /> 负责创建实例。
 *
 * v0.2 起每个标签页挂一个独立的 EditorPane（也就是一个独立的编辑器实例），
 * 这样每个标签页各自保有文档、撤销栈和光标位置，切换标签页不会串味。
 */
export function EditorPane(props: EditorPaneProps) {
  return (
    <MilkdownProvider>
      <EditorPaneInner {...props} />
    </MilkdownProvider>
  )
}

function EditorPaneInner(props: EditorPaneProps) {
  const { mode, visible } = props

  // 用 ref 固定回调身份，避免每次渲染都重新订阅监听器
  const propsRef = useRef(props)
  propsRef.current = props

  const editorRef = useRef<Editor | undefined>(undefined)
  const apiRef = useRef<EditorApi | null>(null)
  const [sourceText, setSourceText] = useState(props.defaultContent)
  const sourceRef = useRef<HTMLTextAreaElement | null>(null)
  const modeRef = useRef<ViewMode>(mode)
  modeRef.current = mode

  const { get, loading } = useEditor(
    buildEditorFactory({
      defaultValue: propsRef.current.defaultContent,
      resolveImage: (src: string) => propsRef.current.resolveImage(src),
      uploader: propsRef.current.uploader,
    }),
    [],
  )

  // 编辑器实例就绪（loading 变 false）后：订阅变更 + 暴露命令接口
  useEffect(() => {
    if (loading) return
    const editor = get()
    if (!editor) return
    editorRef.current = editor

    onMarkdownChange(editor, (markdown) => {
      propsRef.current.onChange(markdown)
      propsRef.current.onStats(readStats(editor))
      propsRef.current.onOutline?.(readOutline(editor))
    })

    const api: EditorApi = {
      getMarkdown: () => readMarkdown(editor),
      setMarkdown: (markdown: string) => writeMarkdown(editor, markdown),
      getRenderedHtml: () => readRenderedHtml(editor),
      undo: () => undo(editor),
      redo: () => redo(editor),
      focus: () =>
        editor.action((ctx) => {
          ctx.get(editorViewCtx)?.focus()
        }),
      getOutline: () => readOutline(editor),
      goToOutline: (pos: number) => jumpToOutline(editor, pos),
      find: (needle: string, caseSensitive: boolean) => findMatches(editor, needle, caseSensitive),
      selectMatch: (match: FindMatch) => selectMatch(editor, match),
      replaceSelection: (text: string) => replaceSelection(editor, text),
      replaceAll: (matches: FindMatch[], text: string) => replaceAllMatches(editor, matches, text),
      findMath: (el: Element) => findMathByElement(editor, el),
      setMathValue: (pos: number, value: string) => setMathValue(editor, pos, value),
    }
    apiRef.current = api
    propsRef.current.onReady(api)

    propsRef.current.onStats(readStats(editor))
    propsRef.current.onOutline?.(readOutline(editor))

    /**
     * 初始内容已经应用完成。
     *
     * 回传「应用后的规范化 markdown」：remark 解析再序列化之后，
     * 内容不一定和文件里的一字不差（空行、列表符号都会被规范化）。
     * 上层拿它当「未修改」基线，才不会一打开就显示成已修改。
     */
    propsRef.current.onApplied?.(readMarkdown(editor))

    return () => {
      editorRef.current = undefined
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // 模式切换：源码 ↔ 所见即所得（编辑器始终保持挂载）
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (mode === 'source') {
      const text = readMarkdown(editor)
      setSourceText(text)
      // 源码模式下上层持有的是原始文本，这里同步一次表示形式
      propsRef.current.onChange(text)
      propsRef.current.onStats(countStats(text))
      requestAnimationFrame(() => sourceRef.current?.focus())
    } else {
      const text = sourceRef.current?.value ?? sourceText
      if (text !== readMarkdown(editor)) writeMarkdown(editor, text)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const handleSourceChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setSourceText(text)
    propsRef.current.onChange(text)
    propsRef.current.onStats(countStats(text))
  }, [])

  /**
   * 正文之外的点击（左右留白 / 正文下方空白）也要能落光标。
   *
   * ProseMirror 只认 contenteditable 内部的事件，contenteditable 之外的
   * 区域默认是「点了没反应」——正文左边的空一大片因此完全不能打字，
   * 必须精确点到文字行上才行。
   *
   * 这里把点击坐标换算成最近的文档位置，主动把光标放过去，
   * 行为：点留白 → 光标落到最近的一行。
   */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 源码模式下由 textarea 自己处理
    if (modeRef.current === 'source') return
    const editor = editorRef.current
    if (!editor) return
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    if (!view) return
    // 落在正文内部 → 交给 ProseMirror 自己的命中测试
    if (view.dom.contains(e.target as Node)) return
    if (!placeCaretAtPoint(view, e.clientX, e.clientY)) return
    e.preventDefault()
  }, [])

  /** 双击公式 → 打开编辑框。 */
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (!target?.closest) return
    const holder = target.closest('[data-math-inline],[data-math-block]')
    if (!holder) return
    const api = apiRef.current
    if (!api) return
    const ref = api.findMath(holder)
    if (!ref) return
    e.preventDefault()
    propsRef.current.onMathEdit(ref)
  }, [])

  return (
    <div
      className={`tfn-editor-pane${visible ? '' : ' is-hidden'}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <div className="tfn-editor-wrap">
        <div className="tfn-editor" hidden={mode === 'source'}>
          <div className="tfn-doc">
            <Milkdown />
          </div>
        </div>
        {mode === 'source' && (
          <textarea
            ref={sourceRef}
            className="tfn-source"
            value={sourceText}
            onChange={handleSourceChange}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}
