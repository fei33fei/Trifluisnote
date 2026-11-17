/** 主进程 / 预加载 / 渲染进程之间共享的类型定义。 */

/**
 * 本地文本文件的编码。
 *
 * `gbk` 是为了老 md 文件准备的 —— 国内用户手上「原本就有」的 md
 * 大多是 GBK/GB18030，按 UTF-8 读会整篇乱码。
 * 保存时按原编码写回，不改用户文件的编码。
 */
export type FileEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk'

/**
 * 一个标签页（窗口内的一个文档）。
 *
 * v0.2 起「窗口」与「文档」解耦：一个窗口可以同时开多个标签页，
 * 每个标签页对应一份独立的文档（自己的路径、编码、脏标记）。
 */
export interface TabState {
  id: string
  /** 文档在磁盘上的路径；null 表示未命名 */
  filePath: string | null
  title: string
  dirty: boolean
  encoding: FileEncoding
}

/** 窗口创建时交给渲染层的初始状态。 */
export interface StartupState {
  tabs: TabState[]
  activeTabId: string
  /** 初始文档内容（窗口带文件启动时才有） */
  content?: string
}

export interface OpenResult {
  ok: boolean
  filePath?: string
  content?: string
  encoding?: FileEncoding
  error?: string
}

export interface SaveResult {
  ok: boolean
  filePath?: string
  error?: string
}

/** 渲染层推给主进程的「自动保存载荷」。 */
export interface AutosavePush {
  tabId: string
  filePath: string | null
  title: string
  encoding: FileEncoding
  content: string
}

/** 主进程回报的自动保存状态。 */
export interface AutosaveEvent {
  tabId: string
  /** pending = 已排队等待落盘；saved = 已写盘；error = 写盘失败 */
  state: 'pending' | 'saved' | 'error'
  /** 落盘内容的哈希：渲染层用它判断「这份内容是不是已经是最新」 */
  hash?: string
  at?: number
  error?: string
}

/** 崩溃恢复快照（上次异常退出时留下的未落盘内容）。 */
export interface RecoveryItem {
  id: string
  filePath: string | null
  title: string
  encoding: FileEncoding
  content: string
  updatedAt: number
}

/** 粘贴 / 拖入图片时的落盘请求。 */
export interface ImageSaveRequest {
  fileName: string
  /** 纯 base64（不含 data: 前缀） */
  data: string
  /** 当前文档路径：决定图片落到文档旁边的 assets/ 还是全局图片目录 */
  docPath: string | null
}

export interface ImageSaveResult {
  ok: boolean
  /** 写进 markdown 的路径（已保存文档用相对路径，未命名文档用绝对路径） */
  path?: string
  absolutePath?: string
  error?: string
}

/** 导出请求：渲染层把已经渲染好的正文 HTML 交过来。 */
export interface ExportPayload {
  html: string
  theme: string
  title: string
  /** 额外的样式（KaTeX 等），直接拼进导出的 <style> */
  extraCss?: string
  /** 正文所在目录，用来定位需要内嵌的本地图片 */
  baseDir?: string | null
}

export interface ExportResult {
  ok: boolean
  filePath?: string
  error?: string
  /** 用户取消 */
  canceled?: boolean
}

/** 预加载脚本通过 contextBridge 暴露给渲染进程的 API。 */
export interface TrifluisnoteApi {
  /** 打开文件对话框并读取内容 */
  openFile(): Promise<OpenResult>
  /** 直接读取指定路径的文件（拖放打开用；编码探测与「打开」一致） */
  readFile(filePath: string): Promise<OpenResult>
  /** 保存到指定路径 */
  saveFile(filePath: string, content: string, encoding?: FileEncoding): Promise<SaveResult>
  /** 另存为 */
  saveFileAs(content: string, suggestedName?: string, encoding?: FileEncoding): Promise<SaveResult>
  /** 新建一个独立窗口 */
  newWindow(): Promise<void>
  /** 查询窗口启动时的初始状态（标签页列表 + 初始内容） */
  getStartupState(): Promise<StartupState | null>
  /** 把渲染层的标签页列表同步给主进程（主进程据此更新窗口标题） */
  syncTabs(tabs: TabState[], activeTabId: string): Promise<void>
  /** 推送一次自动保存候选内容 */
  autosavePush(payload: AutosavePush): Promise<void>
  /** 开关自动保存 */
  setAutoSave(enabled: boolean): Promise<void>
  /** 列出可恢复的崩溃快照 */
  listRecovery(): Promise<RecoveryItem[]>
  /** 处置一个崩溃快照：restore = 恢复，discard = 丢弃 */
  resolveRecovery(id: string, action: 'restore' | 'discard'): Promise<void>
  /** 弹出确认框（关闭脏标签页前询问） */
  confirm(message: string, detail?: string): Promise<boolean>
  /** 保存粘贴 / 拖入的图片到磁盘 */
  saveImage(request: ImageSaveRequest): Promise<ImageSaveResult>
  /** 取某个文档所在目录的 file:// 基础地址（用来解析相对图片路径） */
  baseUrl(filePath: string | null): Promise<string>
  /** 应用信息 */
  getAppInfo(): Promise<{ name: string; version: string; electron: string; chrome: string; node: string }>
  /** 在系统默认程序中打开 */
  revealInFolder(filePath: string): Promise<void>
  /** 导出为独立 HTML 文件 */
  exportHtml(payload: ExportPayload, suggestedName: string): Promise<ExportResult>
  /** 导出为 PDF（主进程用 Chromium printToPDF 渲染） */
  exportPdf(payload: ExportPayload, suggestedName: string): Promise<ExportResult>
  /** 列出可用主题 */
  listThemes(): Promise<{ id: string; name: string; dark: boolean }[]>
  /** 监听主进程推送的自动保存事件 */
  onAutosave(cb: (event: AutosaveEvent) => void): () => void
}

/** 菜单命令转发接口。 */
export interface TrifluisnoteMenuApi {
  onCommand(cb: (command: string, payload?: unknown) => void): () => void
}

declare global {
  interface Window {
    tfn: TrifluisnoteApi
    tfnMenu: TrifluisnoteMenuApi
  }
}
