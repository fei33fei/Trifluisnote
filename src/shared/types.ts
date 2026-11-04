/** 主进程 / 预加载 / 渲染进程之间共享的类型定义。 */

export interface DocState {
  /** 当前文档路径；null 表示未命名文档 */
  filePath: string | null
  /** 是否有未保存改动 */
  dirty: boolean
  /** 窗口标题 */
  title: string
  /** 文档内容（打开文件时由主进程一次性下发） */
  content?: string
}

export interface OpenResult {
  ok: boolean
  filePath?: string
  content?: string
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
