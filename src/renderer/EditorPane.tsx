import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor, editorViewCtx } from '@milkdown/core'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
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
}

export interface EditorPaneProps {
  /**
   * 外部推入的文档内容（打开文件 / 新建文件时由上层送入）。
   *
   * ⚠ 这条通道是**单向**的：它只用于「真正替换整个文档」的场景，
   * 绝不能拿编辑器的变更回灌进来 —— 否则会形成
   * 「编辑器改动 → 回灌 → 整篇 replaceAll → 再次触发改动」的自激循环。
   */
  externalContent: string
  /**
   * 外部内容的版本号，每次外部替换 +1。
   *
   * 即便内容完全相同也要靠它强制重新执行 effect：
   * React 只比较 prop 的值，`content` 没变就不会重新应用。
   */
  externalToken: number
  mode: ViewMode
  /** 编辑器内容发生变化（防抖 200ms 后触发） */
  onChange: (markdown: string) => void
  /** 外部内容已应用完成，回调应用后的规范化 markdown */
  onApplied?: (markdown: string) => void
  onStats: (stats: { words: number; chars: number }) => void
  onReady: (api: EditorApi) => void
  /** 大纲变化时回调（用于侧栏刷新） */
  onOutline?: (items: OutlineItem[]) => void
}

/**
 * Milkdown 的 React 集成要求 useEditor 与 <Milkdown /> 同处一个
 * MilkdownProvider 下：useEditor 负责注册工厂，<Milkdown /> 负责创建实例。
 */
export function EditorPane(props: EditorPaneProps) {
  return (
    <MilkdownProvider>
      <EditorPaneInner {...props} />
    </MilkdownProvider>
  )
}

function EditorPaneInner(props: EditorPaneProps) {
  const { mode } = props

  // 用 ref 固定回调身份，避免每次渲染都重新订阅监听器
  const propsRef = useRef(props)
  propsRef.current = props

  const editorRef = useRef<Editor | undefined>(undefined)
  const [sourceText, setSourceText] = useState(props.externalContent)
  const sourceRef = useRef<HTMLTextAreaElement | null>(null)
  const modeRef = useRef<ViewMode>(mode)
  modeRef.current = mode

  /** 已经应用过的外部内容版本号。 */
  const appliedTokenRef = useRef(props.externalToken)

  const { get, loading } = useEditor(
    buildEditorFactory({ defaultValue: propsRef.current.externalContent }),
    [],
  )

  /**
   * 应用一次外部内容替换。
   *
   * 应用完成后回传「应用后的规范化 markdown」，
   * 上层用它建立「未修改」基线，避免把这次程序化替换误判成用户改动。
   */
  const applyExternal = useCallback((content: string): boolean => {
    const editor = editorRef.current
    if (!editor) return false

    if (modeRef.current === 'source') {
      setSourceText(content)
      propsRef.current.onApplied?.(content)
      return true
    }

    writeMarkdown(editor, content)
    propsRef.current.onApplied?.(readMarkdown(editor))
    return true
  }, [])

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

    propsRef.current.onReady({
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
    })

    propsRef.current.onStats(readStats(editor))
    propsRef.current.onOutline?.(readOutline(editor))

    // 编辑器是异步创建的：若外部内容在就绪之前就到了，这里补一次应用。
    const pending = propsRef.current
    if (appliedTokenRef.current !== pending.externalToken) {
      if (applyExternal(pending.externalContent)) {
        appliedTokenRef.current = pending.externalToken
      }
    }

    return () => {
      editorRef.current = undefined
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

  // 外部内容替换（打开文件 / 新建文件）
  useEffect(() => {
    if (appliedTokenRef.current === props.externalToken) return
    // 编辑器还没就绪时不能标记为「已应用」，否则这份内容就永远丢了；
    // 等就绪后的那个 effect 会补上。
    if (!applyExternal(props.externalContent)) return
    appliedTokenRef.current = props.externalToken
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.externalToken, props.externalContent])

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
   * 行为对齐 Typora：点留白 → 光标落到最近的一行。
   */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 源码模式下由 textarea 自己处理
    if (modeRef.current === 'source') return
    const editor = editorRef.current
    if (!editor) return
    const view = editor.ctx.get(editorViewCtx)
    if (!view) return
    // 落在正文内部 → 交给 ProseMirror 自己的命中测试
    if (view.dom.contains(e.target as Node)) return
    if (!placeCaretAtPoint(view, e.clientX, e.clientY)) return
    e.preventDefault()
  }, [])

  return (
    <div className="tfn-editor-wrap" onMouseDown={handleMouseDown}>
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
  )
}
