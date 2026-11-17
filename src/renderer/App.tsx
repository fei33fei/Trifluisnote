import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorPane, type EditorApi, type ViewMode } from './EditorPane'
import { OutlinePanel } from './OutlinePanel'
import { FindBar } from './FindBar'
import { TabBar } from './TabBar'
import { MathDialog } from './MathDialog'
import { DEFAULT_THEME, THEMES } from '../shared/theme-css'
import { encodingLabel } from '../shared/encoding'
import { basename, dirname } from '../shared/path'
import { hashString } from '../shared/hash'
import { createImageUploader, resolveImageSrc } from '../core/image'
import { KATEX_CSS } from './katex-css'
import type { RecoveryItem, TabState } from '../shared/types'
import type { OutlineItem } from '../core/outline'
import type { FindMatch } from '../core/editor'
import type { MathNodeRef } from '../core/math'

/** 一个标签页（窗口内的一个文档）。 */
interface TabModel extends TabState {
  /** 最近一次从编辑器读到的内容 */
  content: string
  /** 「未保存」基线：最近一次保存 / 打开时的内容 */
  clean: string
  /** 最近一次自动保存落盘的时间 */
  savedAt?: number
}

let tabSeq = 0
function newTabId(): string {
  tabSeq += 1
  return `tab-${Date.now().toString(36)}-${tabSeq}`
}

export function App() {
  const [tabs, setTabs] = useState<TabModel[]>([])
  const [activeId, setActiveId] = useState('')
  const [mode, setMode] = useState<ViewMode>('wysiwyg')
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const [theme, setTheme] = useState<string>(DEFAULT_THEME)
  const [error, setError] = useState<string | null>(null)
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [recovery, setRecovery] = useState<RecoveryItem[]>([])
  const [mathEdit, setMathEdit] = useState<MathNodeRef | null>(null)
  const [autoSave, setAutoSave] = useState(true)

  /** 每个标签页的编辑器接口。 */
  const apisRef = useRef(new Map<string, EditorApi>())
  /** 每个标签页的大纲 / 统计（切换标签页时直接取用）。 */
  const outlinesRef = useRef(new Map<string, OutlineItem[]>())
  const statsRef = useRef(new Map<string, { words: number; chars: number }>())
  /** 每个标签页的图片基准目录（file:// 前缀）。 */
  const baseUrlsRef = useRef(new Map<string, string>())
  /** 自动保存的防抖定时器。 */
  const autosaveTimersRef = useRef(new Map<string, number>())

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  /** 当前视图模式：源码模式下「用户改的就是原始文本」。 */
  const modeRef = useRef<ViewMode>(mode)
  modeRef.current = mode

  const matchesRef = useRef<FindMatch[]>([])

  /* ---------- 标签页 ---------- */

  const createTab = useCallback(
    async (init: Partial<TabModel> & { content?: string } = {}) => {
      const id = newTabId()
      // 图片基准目录要先拿到再挂编辑器：
      // 文档里的相对路径（assets/x.png）只有在知道文档目录的情况下
      // 才能解析成能显示的 file:// 地址，否则首屏就是一片裂图。
      const url = await window.tfn.baseUrl(init.filePath ?? null)
      baseUrlsRef.current.set(id, url)

      const content = init.content ?? ''
      const tab: TabModel = {
        id,
        filePath: init.filePath ?? null,
        title: init.title ?? '未命名',
        encoding: init.encoding ?? 'utf8',
        dirty: init.dirty ?? false,
        content,
        clean: init.clean ?? content,
      }
      setTabs((prev) => [...prev, tab])
      setActiveId(id)
      return id
    },
    [],
  )

  /** 切到某个标签页（同时把大纲、统计切过去）。 */
  const selectTab = useCallback((id: string) => {
    // 切走之前先把上一个标签页的内容推给主进程：
    // 它的防抖还没到，别让磁盘内容落后太多
    const previous = tabsRef.current.find((t) => t.id === activeRef.current)
    if (previous?.dirty && previous.id !== id) {
      void window.tfn.autosavePush({
        tabId: previous.id,
        filePath: previous.filePath,
        title: previous.title,
        encoding: previous.encoding,
        content: previous.content,
      })
    }

    setActiveId(id)
    setOutline(outlinesRef.current.get(id) ?? [])
    setStats(statsRef.current.get(id) ?? { words: 0, chars: 0 })
    requestAnimationFrame(() => apisRef.current.get(id)?.focus())
  }, [])

  const closeTab = useCallback(
    async (id: string) => {
      const list = tabsRef.current
      const tab = list.find((t) => t.id === id)
      if (!tab) return

      if (tab.dirty) {
        const ok = await window.tfn.confirm(
          `「${tab.title}」有未保存的改动`,
          '关闭这个标签页会丢掉还没写进磁盘的内容。已经自动保存过的部分不受影响。',
        )
        if (!ok) return
      }

      const index = list.findIndex((t) => t.id === id)
      const next = list.filter((t) => t.id !== id)

      const timer = autosaveTimersRef.current.get(id)
      if (timer) window.clearTimeout(timer)
      autosaveTimersRef.current.delete(id)
      apisRef.current.delete(id)
      outlinesRef.current.delete(id)
      statsRef.current.delete(id)
      baseUrlsRef.current.delete(id)

      setTabs(next)
      if (next.length === 0) {
        // 不留一个空窗口：自动补一个空白标签页
        createTab()
        return
      }
      if (activeRef.current === id) {
        const fallback = next[Math.min(index, next.length - 1)]
        setActiveId(fallback.id)
        setOutline(outlinesRef.current.get(fallback.id) ?? [])
        setStats(statsRef.current.get(fallback.id) ?? { words: 0, chars: 0 })
      }
    },
    [createTab],
  )

  /* ---------- 文件操作 ---------- */

  const openFile = useCallback(
    async (filePath?: string) => {
      const res = filePath ? await window.tfn.readFile(filePath) : await window.tfn.openFile()
      if (!res.ok) {
        if (res.error) setError(res.error)
        return
      }
      const path = res.filePath ?? null
      // 已经开着的文件就直接切过去，不要开两个标签页
      const existing = tabsRef.current.find((t) => t.filePath && path && t.filePath === path)
      if (existing) {
        selectTab(existing.id)
        return
      }
      createTab({
        filePath: path,
        title: path ? basename(path) : '未命名',
        encoding: res.encoding ?? 'utf8',
        content: res.content ?? '',
      })
    },
    [createTab, selectTab],
  )

  const saveTab = useCallback(async (id: string, saveAs = false) => {
    const tab = tabsRef.current.find((t) => t.id === id)
    const api = apisRef.current.get(id)
    if (!tab || !api) return

    const markdown = api.getMarkdown()

    if (!tab.filePath || saveAs) {
      const suggested = tab.title.endsWith('.md') ? tab.title : `${tab.title}.md`
      const res = await window.tfn.saveFileAs(markdown, suggested, tab.encoding)
      if (!res.ok || !res.filePath) {
        if (res.error) setError(res.error)
        return
      }
      const path = res.filePath
      // 主进程可能把图片搬到了新目录并改写了路径，
      // 这里把落盘后的内容读回来同步给编辑器，保证两边一致。
      const back = await window.tfn.readFile(path)
      const content = back.ok && back.content !== undefined ? back.content : markdown
      api.setMarkdown(content)
      setTabs((prev) =>
        prev.map((t) =>
          t.id !== id
            ? t
            : {
                ...t,
                filePath: path,
                title: basename(path),
                encoding: 'utf8',
                content,
                clean: content,
                dirty: false,
              },
        ),
      )
      void window.tfn.baseUrl(path).then((url) => baseUrlsRef.current.set(id, url))
      return
    }

    const res = await window.tfn.saveFile(tab.filePath, markdown, tab.encoding)
    if (!res.ok) {
      setError(res.error ?? '保存失败')
      return
    }
    setTabs((prev) =>
      prev.map((t) =>
        t.id !== id ? t : { ...t, content: markdown, clean: markdown, dirty: false },
      ),
    )
  }, [])

  /* ---------- 自动保存 ---------- */

  const pushAutosave = useCallback((id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id)
    if (!tab) return
    void window.tfn.autosavePush({
      tabId: id,
      filePath: tab.filePath,
      title: tab.title,
      encoding: tab.encoding,
      content: tab.content,
    })
  }, [])

  /**
   * 内容变化后的自动保存推送。
   *
   * 渲染层只做「延迟一会儿再推」，真正的落盘节奏由主进程控制
   * （停止输入 2 秒后写盘），这里只是避免每个按键都往主进程塞全文。
   */
  const scheduleAutosave = useCallback(
    (id: string) => {
      const existing = autosaveTimersRef.current.get(id)
      if (existing) window.clearTimeout(existing)
      const timer = window.setTimeout(() => {
        autosaveTimersRef.current.delete(id)
        pushAutosave(id)
      }, 1500)
      autosaveTimersRef.current.set(id, timer)
    },
    [pushAutosave],
  )

  useEffect(() => {
    const off = window.tfn.onAutosave((event) => {
      if (event.state === 'saved' && event.hash) {
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id !== event.tabId) return t
            // 内容在落盘之后又变了 → 还是脏的
            if (hashString(t.content) !== event.hash) return t
            return { ...t, clean: t.content, dirty: false, savedAt: event.at }
          }),
        )
      } else if (event.state === 'error') {
        setError(`自动保存失败：${event.error ?? '未知错误'}`)
      }
    })
    return off
  }, [])

  /* ---------- 内容变化 ---------- */

  const handleChange = useCallback(
    (tabId: string, markdown: string) => {
      // 源码模式下用户改的就是原始文本，直接用载荷；
      // 所见即所得模式下要用编辑器的实时序列化 ——
      // 防抖回调里的载荷不一定包含 appendTransaction 的产物
      // （trailing 补的空段落等），拿它和基线比会误判成「已修改」。
      const api = apisRef.current.get(tabId)
      const current = modeRef.current === 'source' ? markdown : api?.getMarkdown() ?? markdown
      setTabs((prev) =>
        prev.map((t) =>
          t.id !== tabId ? t : { ...t, content: current, dirty: current !== t.clean },
        ),
      )
      scheduleAutosave(tabId)
    },
    [scheduleAutosave],
  )

  /**
   * 编辑器已应用完初始内容。
   *
   * 用规范化后的内容当「未修改」基线：文件里的原文和 remark 往返之后
   * 未必一字不差，不对齐基线的话，一打开文档就被标成「已修改」。
   */
  const handleApplied = useCallback((tabId: string, canonical: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id !== tabId ? t : { ...t, content: canonical, clean: canonical, dirty: false },
      ),
    )
  }, [])

  const handleStats = useCallback((tabId: string, value: { words: number; chars: number }) => {
    statsRef.current.set(tabId, value)
    if (tabId === activeRef.current) setStats(value)
  }, [])

  const handleOutline = useCallback((tabId: string, items: OutlineItem[]) => {
    outlinesRef.current.set(tabId, items)
    if (tabId === activeRef.current) setOutline(items)
  }, [])

  /* ---------- 导出 ---------- */

  const exportPayload = useCallback(
    () => {
      const tab = tabsRef.current.find((t) => t.id === activeRef.current)
      const api = apisRef.current.get(activeRef.current)
      return {
        html: api?.getRenderedHtml() ?? '',
        theme,
        title: tab?.title ?? '未命名',
        extraCss: KATEX_CSS,
        baseDir: tab?.filePath ? dirname(tab.filePath) : null,
      }
    },
    [theme],
  )

  const handleExportHtml = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeRef.current)
    const base = (tab?.title ?? '未命名').replace(/\.md$/i, '') || '未命名'
    const res = await window.tfn.exportHtml(exportPayload(), `${base}.html`)
    if (!res.ok && res.error) setError(res.error)
  }, [exportPayload])

  const handleExportPdf = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeRef.current)
    const base = (tab?.title ?? '未命名').replace(/\.md$/i, '') || '未命名'
    const res = await window.tfn.exportPdf(exportPayload(), `${base}.pdf`)
    if (!res.ok && res.error) setError(res.error)
  }, [exportPayload])

  /* ---------- 查找替换 ---------- */

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
    const id = requestAnimationFrame(() => apisRef.current.get(activeRef.current)?.focus())
    return () => cancelAnimationFrame(id)
  }, [findOpen])

  const handleSearch = useCallback((needle: string, caseSensitive: boolean) => {
    const api = apisRef.current.get(activeRef.current)
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
    const api = apisRef.current.get(activeRef.current)
    if (!api || !matches[index]) return
    api.selectMatch(matches[index])
  }, [])

  const handleReplaceOne = useCallback((text: string) => {
    apisRef.current.get(activeRef.current)?.replaceSelection(text)
  }, [])

  const handleReplaceAll = useCallback((text: string) => {
    const api = apisRef.current.get(activeRef.current)
    if (!api) return 0
    const n = api.replaceAll(matchesRef.current, text)
    matchesRef.current = []
    return n
  }, [])

  /* ---------- 标签页切换 ---------- */

  const cycleTab = useCallback(
    (delta: number) => {
      const list = tabsRef.current
      if (list.length < 2) return
      const index = list.findIndex((t) => t.id === activeRef.current)
      const next = list[(index + delta + list.length) % list.length]
      selectTab(next.id)
    },
    [selectTab],
  )

  /* ---------- 菜单命令 ---------- */

  useEffect(() => {
    const off = window.tfnMenu.onCommand((command, payload) => {
      switch (command) {
        case 'file.newWindow':
          void window.tfn.newWindow()
          break
        case 'file.newTab':
        case 'file.newFile':
          createTab()
          break
        case 'file.open':
          void openFile()
          break
        case 'file.openPaths': {
          const paths = Array.isArray(payload) ? (payload as string[]) : []
          for (const p of paths) void openFile(p)
          break
        }
        case 'file.save':
          void saveTab(activeRef.current)
          break
        case 'file.saveAs':
          void saveTab(activeRef.current, true)
          break
        case 'file.closeTab':
          void closeTab(activeRef.current)
          break
        case 'file.exportHtml':
          void handleExportHtml()
          break
        case 'file.exportPdf':
          void handleExportPdf()
          break
        case 'file.reveal': {
          const tab = tabsRef.current.find((t) => t.id === activeRef.current)
          if (tab?.filePath) void window.tfn.revealInFolder(tab.filePath)
          break
        }
        case 'settings.toggleAutoSave':
          setAutoSave((prev) => {
            const next = !prev
            void window.tfn.setAutoSave(next)
            return next
          })
          break
        case 'edit.undo':
          apisRef.current.get(activeRef.current)?.undo()
          break
        case 'edit.redo':
          apisRef.current.get(activeRef.current)?.redo()
          break
        case 'edit.find':
          openFind()
          break
        case 'view.nextTab':
          cycleTab(1)
          break
        case 'view.prevTab':
          cycleTab(-1)
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
    closeTab,
    createTab,
    cycleTab,
    handleExportHtml,
    handleExportPdf,
    openFile,
    openFind,
    saveTab,
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
      if (!nativePath) return
      // 交给主进程读：编码探测、绝对路径、错误提示都和「打开…」完全一致。
      void openFile(nativePath)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openFile])

  /* ---------- 主题 / 标题 ---------- */

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeId)
    document.title = tab?.filePath ? `${tab.title} — Trifluisnote` : 'Trifluisnote'
  }, [tabs, activeId])

  /**
   * 把标签页清单同步给主进程。
   *
   * 主进程据此更新窗口标题（活动标签页的名字 + 未保存标记）。
   */
  const syncKey = useMemo(
    () =>
      `${tabs
        .map((t) => `${t.id}|${t.filePath}|${t.title}|${t.dirty ? 1 : 0}|${t.encoding}`)
        .join(';')}#${activeId}`,
    [tabs, activeId],
  )

  useEffect(() => {
    // 还没拿到初始文档时不要同步空清单，否则主进程会把窗口标题冲成「Trifluisnote」
    if (!tabs.length) return
    void window.tfn.syncTabs(
      tabs.map((t) => ({
        id: t.id,
        filePath: t.filePath,
        title: t.title,
        dirty: t.dirty,
        encoding: t.encoding,
      })),
      activeId,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey])

  /* ---------- 快捷键（窗口内） ---------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 's') {
        e.preventDefault()
        if (e.shiftKey) void saveTab(activeRef.current, true)
        else void saveTab(activeRef.current)
      } else if (e.key === 'o') {
        e.preventDefault()
        void openFile()
      } else if (e.key === 'f') {
        e.preventDefault()
        openFind()
      } else if (e.key === 't' && !e.shiftKey) {
        e.preventDefault()
        createTab()
      } else if (e.key === 'w') {
        e.preventDefault()
        void closeTab(activeRef.current)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        cycleTab(e.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeTab, createTab, cycleTab, openFile, openFind, saveTab])

  /* ---------- 窗口失焦：赶紧落盘 ---------- */

  useEffect(() => {
    const onBlur = () => {
      for (const tab of tabsRef.current) {
        if (tab.dirty) pushAutosave(tab.id)
      }
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [pushAutosave])

  /* ---------- 首屏：取回本窗口的初始文档 + 崩溃快照 ---------- */

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const state = await window.tfn.getStartupState()
      if (cancelled) return
      const first = state?.tabs?.[0]
      /**
       * 首屏内容 = 主进程给的内容，给什么显示什么。
       *
       * 启动内容（示例文档）由主进程决定要不要给：只有「安装后第一次启动」
       * 才下发一次，平时启动这里就是空的 —— 空白页。
       * 渲染层不再自带默认文案，免得每次启动都自动冒出一段内容。
       */
      const content = state?.content ?? ''
      const id = first?.id ?? newTabId()
      // 图片基准目录要在编辑器挂载前拿到（见 createTab 的注释）
      const url = await window.tfn.baseUrl(first?.filePath ?? null)
      if (cancelled) return
      baseUrlsRef.current.set(id, url)
      const tab: TabModel = {
        id,
        filePath: first?.filePath ?? null,
        title: first?.title ?? '未命名',
        encoding: first?.encoding ?? 'utf8',
        dirty: false,
        content,
        clean: content,
      }
      setTabs([tab])
      setActiveId(id)

      const items = await window.tfn.listRecovery()
      if (!cancelled && items.length) setRecovery(items)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ---------- 崩溃恢复 ---------- */

  const restoreRecovery = useCallback(
    async (item: RecoveryItem) => {
      await window.tfn.resolveRecovery(item.id, 'restore')
      setRecovery((prev) => prev.filter((x) => x.id !== item.id))
      createTab({
        filePath: item.filePath,
        title: item.title,
        encoding: item.encoding,
        content: item.content,
        dirty: true,
      })
    },
    [createTab],
  )

  const discardRecovery = useCallback(async (item: RecoveryItem) => {
    await window.tfn.resolveRecovery(item.id, 'discard')
    setRecovery((prev) => prev.filter((x) => x.id !== item.id))
  }, [])

  /* ---------- 渲染 ---------- */

  const themeOptions = useMemo(() => THEMES, [])
  const activeTab = tabs.find((t) => t.id === activeId)

  /** 图片路径解析：按标签页各自的文档目录。 */
  const resolveImageFor = useCallback(
    (tabId: string) => (src: string) => resolveImageSrc(src, baseUrlsRef.current.get(tabId) ?? ''),
    [],
  )

  /** 粘贴图片的落盘器：按标签页各自的文档目录。 */
  const uploaderFor = useCallback(
    (tabId: string) =>
      createImageUploader({
        save: async (fileName, data) => {
          const tab = tabsRef.current.find((t) => t.id === tabId)
          const res = await window.tfn.saveImage({
            fileName,
            data,
            docPath: tab?.filePath ?? null,
          })
          return res.ok ? res.path ?? null : null
        },
      }),
    [],
  )

  return (
    <div className="tfn-app">
      <header className="tfn-toolbar">
        <button className="tfn-btn tfn-btn--primary" onClick={() => void openFile()}>
          打开
        </button>
        <button
          className="tfn-btn"
          onClick={() => void saveTab(activeId)}
          disabled={!activeTab?.dirty && !!activeTab?.filePath}
        >
          保存
        </button>
        <button className="tfn-btn" onClick={() => void saveTab(activeId, true)}>
          另存为
        </button>
        <button className="tfn-btn" onClick={() => createTab()}>
          新建标签页
        </button>
        <button className="tfn-btn" onClick={() => void window.tfn.newWindow()}>
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
          {activeTab?.title ?? ''}
          {activeTab?.dirty ? ' •' : ''}
        </span>
      </header>

      <TabBar
        tabs={tabs.map((t) => ({ id: t.id, title: t.title, dirty: t.dirty }))}
        activeId={activeId}
        onSelect={(id) => selectTab(id)}
        onClose={(id) => void closeTab(id)}
        onNew={() => createTab()}
      />

      {recovery.length > 0 && (
        <div className="tfn-recovery" role="status">
          <span className="tfn-recovery__title">发现未保存的内容（上次可能异常退出）</span>
          {recovery.map((item) => (
            <span key={item.id} className="tfn-recovery__item">
              <span className="tfn-recovery__name">{item.title}</span>
              <button className="tfn-btn" onClick={() => void restoreRecovery(item)}>
                恢复
              </button>
              <button className="tfn-btn" onClick={() => void discardRecovery(item)}>
                丢弃
              </button>
            </span>
          ))}
          <button
            className="tfn-btn"
            onClick={() => {
              for (const item of recovery) void discardRecovery(item)
            }}
          >
            全部丢弃
          </button>
        </div>
      )}

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
            apisRef.current.get(activeId)?.goToOutline(pos)
            setOutlineOpen(false)
          }}
        />

        <main className="tfn-editor-host">
          {tabs.map((tab) => (
            <EditorPane
              key={tab.id}
              tabId={tab.id}
              defaultContent={tab.content}
              visible={tab.id === activeId}
              mode={mode}
              resolveImage={resolveImageFor(tab.id)}
              uploader={uploaderFor(tab.id)}
              onChange={(markdown) => handleChange(tab.id, markdown)}
              onApplied={(canonical) => handleApplied(tab.id, canonical)}
              onStats={(value) => handleStats(tab.id, value)}
              onOutline={(items) => handleOutline(tab.id, items)}
              onReady={(api) => apisRef.current.set(tab.id, api)}
              onMathEdit={(ref) => setMathEdit(ref)}
            />
          ))}
        </main>
      </div>

      <footer className="tfn-statusbar">
        <span>{activeTab?.filePath ?? '未保存到磁盘'}</span>
        <span className="tfn-statusbar__spacer" />
        {activeTab?.savedAt && !activeTab.dirty && (
          <span>已自动保存 {new Date(activeTab.savedAt).toLocaleTimeString()}</span>
        )}
        {autoSave && !activeTab?.savedAt && <span>自动保存已开启</span>}
        <span>{encodingLabel(activeTab?.encoding ?? 'utf8')}</span>
        <span>{mode === 'source' ? '源码模式' : '所见即所得'}</span>
        <span>{stats.words} 字</span>
        <span>{stats.chars} 字符</span>
      </footer>

      {mathEdit && (
        <MathDialog
          value={mathEdit.value}
          onCancel={() => setMathEdit(null)}
          onApply={(value) => {
            apisRef.current.get(activeId)?.setMathValue(mathEdit.pos, value)
            setMathEdit(null)
          }}
        />
      )}

      {error && (
        <div className="tfn-error" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  )
}
