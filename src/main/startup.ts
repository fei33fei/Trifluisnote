import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * 启动内容 —— 只在「安装完毕后的第一次启动」出现一次。
 *
 * 放在主进程而不是渲染层：渲染层只负责「显示主进程给的内容」，
 * 「什么时候给、给不给」属于启动策略，留在主进程才有唯一真相源。
 */
export const STARTUP_CONTENT = `# Trifluisnote

欢迎使用 **Trifluisnote** —— 一个所见即所得的 Markdown 桌面编辑器。

- [x] 表格、任务列表、删除线（GFM）
- [x] 代码高亮
- [x] 大纲、查找替换
- [x] 导出 HTML / PDF
- [x] 窗口内标签页
- [x] 自动保存 / 崩溃恢复
- [x] 图片落盘
- [x] 数学公式（KaTeX）

> 输入 Markdown 的同时就能看到渲染结果。

\`\`\`js
console.log('hello, trifluis')
\`\`\`

| 功能 | 状态 | 备注 |
| --- | --- | --- |
| 所见即所得 | ✅ | ProseMirror + remark |
| 标签页 | ✅ | 一个窗口多个文档 |
| 导出 PDF | ✅ | Chromium printToPDF |
`

/**
 * 标记文件名。
 *
 * 存在 = 之前已经启动过 = 以后一律空白页；
 * 不存在 = 还没跑过 = 本次是安装后首次启动。
 *
 * 开发态（直接跑 electron.exe / electron-vite dev）用独立的文件名：
 * 开发目录和安装版共用同一个 userData 目录，标记要是同名，
 * 你调试着调试着就把「安装后首次启动」的资格先吃掉了，
 * 等真装上时反而不显示启动内容。
 */
const MARKER_NAME = app.isPackaged ? 'first-run.done' : 'first-run.dev.done'

/**
 * 本次启动是否处于「安装后首次启动」状态。
 *
 * 判定后立刻把标记落盘：哪怕这次启动中途崩了，
 * 下次也直接空白页，不反复拿示例内容骚扰用户。
 */
let pendingStartupContent = false

/** 已经判定过没有 —— 重复调用 initStartup 不能再判一次。 */
let initialized = false

/**
 * 启动时判定「是不是安装后第一次启动」。
 *
 * 判定依据是 userData 里有没有标记文件 —— 那是属于「这台机器上的这个应用」
 * 的状态，重装 / 换机器自然重新算一次。
 */
export function initStartup(): void {
  // 幂等：判两次会把刚写下的标记当成「已经跑过」，
  // 首次启动内容就永远发不出去了。
  if (initialized) return
  initialized = true
  try {
    const dir = app.getPath('userData')
    const marker = join(dir, MARKER_NAME)
    pendingStartupContent = !existsSync(marker)
    if (pendingStartupContent) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(marker, new Date().toISOString(), 'utf8')
    }
  } catch {
    // userData 写不了（极少见）：退化成「永远空白页」，
    // 宁可不显示，也别让应用启动失败。
    pendingStartupContent = false
  }
}

/**
 * 取走启动内容，只给本次启动的第一个空白窗口。
 *
 * 「取走即失效」：同一次启动里后续新开的窗口都是空白页，
 * 启动内容全局只出现一次。
 */
export function takeStartupContent(): string | null {
  if (!pendingStartupContent) return null
  pendingStartupContent = false
  return STARTUP_CONTENT
}
