/** 主进程 / 预加载 / 渲染进程之间共享的类型定义。 */

/**
 * 本地文本文件的编码。
 *
 * `gbk` 是为了老 md 文件准备的 —— 国内用户手上「原本就有」的 md
 * 大多是 GBK/GB18030，按 UTF-8 读会整篇乱码。
 * 保存时按原编码写回，不改用户文件的编码。
 */
export type FileEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk'

export interface DocState {
  /** 当前文档路径；null 表示未命名文档 */
  filePath: string | null
  /** 是否有未保存改动 */
  dirty: boolean
  /** 窗口标题 */
  title: string
  /** 文档内容（打开文件时由主进程一次性下发） */
  content?: string
  /** 当前文件的编码（保存时按它写回） */
  encoding?: FileEncoding
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

/** 导出请求：渲染层把已经渲染好的正文 HTML 交过来。 */
export interface ExportPayload {
  html: string
  theme: string
  title: string
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
  saveFile(filePath: string, content: string): Promise<SaveResult>
  /** 另存为 */
  saveFileAs(content: string, suggestedName?: string): Promise<SaveResult>
  /** 新建一个独立窗口（记事本式多窗口） */
  newWindow(): Promise<void>
  /** 查询当前窗口的文档状态 */
  getDocState(): Promise<DocState>
  /** 上报文档状态变化 */
  setDocState(patch: Partial<DocState>): Promise<void>
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
  /** 监听主进程推送的窗口标题/状态变化 */
  onDocState(cb: (state: DocState) => void): () => void
}

/** 菜单命令转发接口。 */
export interface TrifluisnoteMenuApi {
  onCommand(cb: (command: string) => void): () => void
}

declare global {
  interface Window {
    tfn: TrifluisnoteApi
    tfnMenu: TrifluisnoteMenuApi
  }
}
