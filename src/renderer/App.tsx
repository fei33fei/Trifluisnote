import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorPane, type EditorApi, type ViewMode } from './EditorPane'
import { OutlinePanel } from './OutlinePanel'
import { FindBar } from './FindBar'
import { DEFAULT_THEME, THEMES } from '../shared/theme-css'
import type { OutlineItem } from '../core/outline'
import type { FindMatch } from '../core/editor'

const WELCOME = `# Trifluisnote

欢迎使用 **Trifluisnote** —— 一个所见即所得的 Markdown 桌面编辑器。

- [x] 表格、任务列表、删除线（GFM）
- [x] 代码高亮
- [x] 大纲、查找替换
- [x] 导出 HTML / PDF

> 与 Typora 一样，输入 Markdown 的同时就能看到渲染结果。

\`\`\`js
console.log('hello, trifluis')
\`\`\`

| 功能 | 状态 | 备注 |
| --- | --- | --- |
| 所见即所得 | ✅ | ProseMirror + remark |
| 多窗口 | ✅ | 记事本式 |
| 导出 PDF | ✅ | Chromium printToPDF |
`

interface DocInfo {
  filePath: string | null
  dirty: boolean
  title: string
}

/**
 * 外部内容（打开文件 / 新建文件）与它的版本号。
 *
 * 版本号是必需的：内容完全相同时 React 不会重新执行 effect，
 * 而「重新打开同一个文件」必须真的把编辑器复位。
 */
interface ExternalContent {
  token: number
  content: string
}

export function App() {
  const [external, setExternal] = useState<ExternalContent>({ token: 0, content: WELCOME })
  const [doc, setDoc] = useState<DocInfo>({ filePath: null, dirty: false, title: '未命名' })
  const [mode, setMode] = useState<ViewMode>('wysiwyg')
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const [theme, setTheme] = useState<string>(DEFAULT_THEME)
  const [error, setError] = useState<string | null>(null)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)

  const apiRef = useRef<EditorApi | null>(null)
  const dirtyRef = useRef(false)
  const matchesRef = useRef<FindMatch[]>([])

  /**
   * 文档当前内容。
   *
   * 用 ref 而不是 state —— 这是修掉「content 反馈回路」的关键。
   *
   * 曾经的写法是：编辑器的 `markdownUpdated` → `setContent(markdown)` →
   * EditorPane 的 effect 发现 `content !== readMarkdown(editor)` →
   * 整篇 `replaceAll` → 再次触发 `markdownUpdated` → 无限自激。
   *
   * 之所以不相等，是因为 `markdownUpdated` 的载荷是防抖回调里
   * `latestTr.doc` 的序列化结果，**不包含 `appendTransaction` 的产物**
   * （例如 trailing 插件补的空段落）；而 `readMarkdown(editor)` 读的是
   * 当前 state，两者天然可能不一致。于是每 200ms 就整篇重写一次文档，
   * 表现为勾选被回滚、结构被反复重排。
   *
   * 现在：编辑器的变化只写 ref（单向），只有「打开文件 / 新建」这类
   * 真正的外部替换才会回到 state 并推给编辑器。
   */
  const markdownRef = useRef(WELCOME)

  /** 「未修改」基线：最近一次打开 / 保存时的文档内容，用于计算脏标记。 */
  const cleanRef = useRef(WELCOME)

  /** 用户是否已经主动操作过文档（用于忽略首屏的异步回填）。 */
  const userActionRef = useRef(false)

  const modeRef = useRef<ViewMode>('wysiwyg')
  modeRef.current = mode

  /** 当前文档内容（所见即所得下取实时序列化，源码模式下取原始文本）。 */
  const currentMarkdown = useCallback(() => {
    if (modeRef.current === 'source') return markdownRef.current
    return apiRef.current?.getMarkdown() ?? markdownRef.current
  }, [])

  /** 统一的脏标记更新。 */
  const applyDirty = useCallback((dirty: boolean) => {
    if (dirtyRef.current === dirty) return
    dirtyRef.current = dirty
    setDoc((d) => ({ ...d, dirty }))
    void window.tfn.setDocState({ dirty })
  }, [])

  /** 把一份新的外部内容推给编辑器（单向通道）。 */
  const pushExternal = useCallback((content: string) => {
    setExternal((prev) => ({ token: prev.token + 1, content }))
  }, [])

  /* ---------- 文件操作 ---------- */

  const handleOpen = useCallback(async () => {
    const res = await window.tfn.openFile()
    if (!res.ok) return
    if (res.error) {
      setError(res.error)
      return
    }
    userActionRef.current = true
    const content = res.content ?? ''
    markdownRef.current = content
    pushExternal(content)
    setDoc((d) => ({
      ...d,
      filePath: res.filePath ?? null,
      dirty: false,
      title: baseName(res.filePath ?? null),
    }))
    dirtyRef.current = false
    await window.tfn.setDocState({ filePath: res.filePath ?? null, dirty: false })
  }, [pushExternal])

  const handleSaveAs = useCallback(async () => {
    const markdown = currentMarkdown()
    const res = await window.tfn.saveFileAs(
      markdown,
      doc.title.endsWith('.md') ? doc.title : `${doc.title}.md`,
    )
    if (res.ok && res.filePath) {
      cleanRef.current = markdown
      applyDirty(false)
      setDoc((d) => ({ ...d, filePath: res.filePath!, dirty: false, title: baseName(res.filePath!) }))
      await window.tfn.setDocState({ filePath: res.filePath, dirty: false })
    } else if (res.error) {
      setError(res.error)
    }
  }, [currentMarkdown, doc.title, applyDirty])

  const handleSave = useCallback(async () => {
    const markdown = currentMarkdown()
    if (!doc.filePath) return handleSaveAs()
    const res = await window.tfn.saveFile(doc.filePath, markdown)
    if (res.ok) {
      cleanRef.current = markdown
      applyDirty(false)
      await window.tfn.setDocState({ dirty: false })
    } else {
      setError(res.error ?? '保存失败')
    }
  }, [doc.filePath, currentMarkdown, handleSaveAs, applyDirty])

  const handleNewFile = useCallback(() => {
    userActionRef.current = true
    markdownRef.current = ''
    pushExternal('')
    setDoc({ filePath: null, dirty: false, title: '未命名' })
    dirtyRef.current = false
    void window.tfn.setDocState({ filePath: null, dirty: false, title: '未命名' })
  }, [pushExternal])

  const handleNewWindow = useCallback(() => {
    void window.tfn.newWindow()
  }, [])

  /* ---------- 导出 ---------- */

  const exportPayload = useCallback(
    () => ({
      html: apiRef.current?.getRenderedHtml() ?? '',
      theme,
      title: doc.title,
    }),
    [theme, doc.title],
  )

  const handleExportHtml = useCallback(async () => {
    const base = doc.title.replace(/\.md$/i, '') || '未命名'
    const res = await window.tfn.exportHtml(exportPayload(), `${base}.html`)
    if (!res.ok && res.error) setError(res.error)
  }, [exportPayload, doc.title])

  const handleExportPdf = useCallback(async () => {
    const base = doc.title.replace(/\.md$/i, '') || '未命名'
    const res = await window.tfn.exportPdf(exportPayload(), `${base}.pdf`)
    if (!res.ok && res.error) setError(res.error)
  }, [exportPayload, doc.title])

  /* ---------- 内容变化 ---------- */

  /**
   * 编辑器内容变化。
   *
   * `payload` 是防抖回调里的序列化结果，可能不含 `appendTransaction` 的产物，
   * 所以脏标记一律以「当前 state 的实时序列化」为准，避免误判。
   */
  const handleChange = useCallback(
    (payload: string) => {
      if (modeRef.current === 'source') {
        // 源码模式：载荷就是原始文本
        markdownRef.current = payload
        applyDirty(payload !== cleanRef.current)
        return
      }
      const current = apiRef.current?.getMarkdown() ?? payload
      markdownRef.current = current
      applyDirty(current !== cleanRef.current)
    },
    [applyDirty],
  )

  /**
   * 外部内容已应用。
   *
   * 此时编辑器里的内容就是「刚打开」的状态，把基线对齐过去，
   * 免得程序化替换被当成用户改动（进而把文件标记成已修改）。
   */
  const handleApplied = useCallback(
    (canonical: string) => {
      markdownRef.current = canonical
      cleanRef.current = canonical
      applyDirty(false)
    },
    [applyDirty],
  )

  /* ---------- 查找替换 ---------- */

  /**
   * 查找栏开合。
   *
   * 工具栏上的「查找」按钮是开关：点一下展开，再点一下收起。
   * Ctrl+F / 菜单里的「查找…」则是「确保展开」，不取反。
   */
  const toggleFind = useCallback(() => {
    setFindOpen((v) => !v)
  }, [])

  const openFind = useCallback(() => {
    setFindOpen(true)
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
  }, [])

  /**
   * 查找栏关闭后把焦点交还给编辑器。
   *
   * 否则焦点会掉在已经被卸载的输入框上，此时按键盘等于「什么也没输入」。
   */
  useEffect(() => {
    if (findOpen) return
    const id = requestAnimationFrame(() => apiRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [findOpen])

  const handleSearch = useCallback((needle: string, caseSensitive: boolean) => {
    const api = apiRef.current
    if (!api) {
      matchesRef.current = []
      return 0
    }
    const matches = api.find(needle, caseSensitive)
    matchesRef.current = matches
    return matches.length
  }, [])

  const handleGoTo = useCallback((index: number) => {
    const matches = matchesRef.current
    const api = apiRef.current
    if (!api || !matches[index]) return
    api.selectMatch(matches[index])
  }, [])

  const handleReplaceOne = useCallback(
    (text: string) => {
      const api = apiRef.current
      if (!api) return
      api.replaceSelection(text)
    },
    [],
  )

  const handleReplaceAll = useCallback(
    (text: string) => {
      const api = apiRef.current
      if (!api) return 0
      const n = api.replaceAll(matchesRef.current, text)
      matchesRef.current = []
      return n
    },
    [],
  )

  /* ---------- 菜单命令 ---------- */

  useEffect(() => {
    const off = window.tfnMenu.onCommand((command) => {
      switch (command) {
        case 'file.newWindow':
          handleNewWindow()
          break
        case 'file.newFile':
          handleNewFile()
          break
        case 'file.open':
          void handleOpen()
          break
        case 'file.save':
          void handleSave()
          break
        case 'file.saveAs':
          void handleSaveAs()
          break
        case 'file.exportHtml':
          void handleExportHtml()
          break
        case 'file.exportPdf':
          void handleExportPdf()
          break
        case 'file.reveal':
          if (doc.filePath) void window.tfn.revealInFolder(doc.filePath)
          break
        case 'edit.undo':
          apiRef.current?.undo()
          break
        case 'edit.redo':
          apiRef.current?.redo()
          break
        case 'edit.find':
          openFind()
          break
        case 'view.toggleSourceMode':
          setMode((m) => (m === 'source' ? 'wysiwyg' : 'source'))
          break
        case 'view.toggleOutline':
          setOutlineOpen((v) => !v)
          break
        case 'view.cycleTheme': {
          const idx = THEMES.findIndex((t) => t.id === theme)
          setTheme(THEMES[(idx + 1) % THEMES.length].id)
          break
        }
        default:
          break
      }
    })
    return off
  }, [
    doc.filePath,
    handleExportHtml,
    handleExportPdf,
    handleNewFile,
    handleNewWindow,
    handleOpen,
    handleSave,
    handleSaveAs,
    openFind,
    theme,
  ])

  /* ---------- 拖放打开 ---------- */

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      // Electron 的 File 带有原生绝对路径，DOM 类型里没有
      const nativePath = (file as File & { path?: string }).path
      const reader = new FileReader()
      reader.onload = () => {
        const text = String(reader.result ?? '')
        userActionRef.current = true
        markdownRef.current = text
        pushExternal(text)
        setDoc((d) => ({ ...d, filePath: nativePath ?? null, dirty: false, title: file.name }))
        dirtyRef.current = false
        void window.tfn.setDocState({ filePath: nativePath ?? null, dirty: false })
      }
      reader.readAsText(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [pushExternal])

  /* ---------- 主题 ---------- */

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  /* ---------- 快捷键（窗口内） ---------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 's') {
        e.preventDefault()
        if (e.shiftKey) void handleSaveAs()
        else void handleSave()
      } else if (e.key === 'o') {
        e.preventDefault()
        void handleOpen()
      } else if (e.key === 'f') {
        e.preventDefault()
        openFind()
      } else if (e.key === 'n' && e.altKey) {
        e.preventDefault()
        handleNewFile()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleOpen, handleSave, handleSaveAs, handleNewFile, openFind])

  const onReady = useCallback((api: EditorApi) => {
    apiRef.current = api
  }, [])

  /* ---------- 首屏：向主进程取回本窗口的文档 ---------- */

  useEffect(() => {
    let cancelled = false
    void window.tfn.getDocState().then((state) => {
      if (cancelled || !state) return
      // 用户已经手动打开过别的文件，就不要用命令行传入的文档覆盖它
      if (userActionRef.current) return
      const content = state.content ?? ''
      if (content) {
        markdownRef.current = content
        pushExternal(content)
      }
      setDoc({ filePath: state.filePath, dirty: state.dirty, title: state.title })
    })
    return () => {
      cancelled = true
    }
  }, [pushExternal])

  const themeOptions = useMemo(() => THEMES, [])

  return (
    <div className="tfn-app">
      <header className="tfn-toolbar">
        <button className="tfn-btn tfn-btn--primary" onClick={() => void handleOpen()}>
          打开
        </button>
        <button className="tfn-btn" onClick={() => void handleSave()} disabled={!doc.dirty && !!doc.filePath}>
          保存
        </button>
        <button className="tfn-btn" onClick={() => void handleSaveAs()}>
          另存为
        </button>
        <button className="tfn-btn" onClick={handleNewWindow}>
          新窗口
        </button>
        <span className="tfn-toolbar__sep" />
        <button className="tfn-btn" onClick={() => void handleExportHtml()}>
          导出 HTML
        </button>
        <button className="tfn-btn" onClick={() => void handleExportPdf()}>
          导出 PDF
        </button>
        <span className="tfn-toolbar__sep" />
        <button className="tfn-btn" onClick={() => setMode((m) => (m === 'source' ? 'wysiwyg' : 'source'))}>
          {mode === 'source' ? '所见即所得' : '源码模式'}
        </button>
        <button
          className="tfn-btn"
          onClick={toggleFind}
          title="查找 (Ctrl+F)"
          aria-expanded={findOpen}
        >
          查找
        </button>
        <select
          className="tfn-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          title="主题"
        >
          {themeOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="tfn-toolbar__title">
          {doc.title}
          {doc.dirty ? ' •' : ''}
        </span>
      </header>

      <FindBar
        open={findOpen}
        onClose={closeFind}
        onSearch={handleSearch}
        onGoTo={handleGoTo}
        onReplaceOne={handleReplaceOne}
        onReplaceAll={handleReplaceAll}
      />

      <div className="tfn-body">
        <OutlinePanel
          items={outline}
          open={outlineOpen}
          onToggle={() => setOutlineOpen((v) => !v)}
          onSelect={(pos) => {
            apiRef.current?.goToOutline(pos)
            setOutlineOpen(false)
          }}
        />

        <main className="tfn-editor-host">
          <EditorPane
            externalContent={external.content}
            externalToken={external.token}
            mode={mode}
            onChange={handleChange}
            onApplied={handleApplied}
            onStats={setStats}
            onReady={onReady}
            onOutline={setOutline}
          />
        </main>
      </div>

      <footer className="tfn-statusbar">
        <span>{doc.filePath ?? '未保存到磁盘'}</span>
        <span className="tfn-statusbar__spacer" />
        <span>{mode === 'source' ? '源码模式' : '所见即所得'}</span>
        <span>{stats.words} 字</span>
        <span>{stats.chars} 字符</span>
      </footer>

      {error && (
        <div className="tfn-error" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  )
}

function baseName(filePath: string | null): string {
  if (!filePath) return '未命名'
  return filePath.split(/[\\/]/).pop() ?? filePath
}
