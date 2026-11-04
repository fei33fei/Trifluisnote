# Trifluisnote

Trifluisnote —— 对 md 文件进行编辑修改的工具：一个所见即所得的 Markdown 桌面编辑器，
功能对齐 Typora，**不需要激活码，开箱即用**。

> 设计依据来自开发工作区中的 `REPORT.md`（Typora 逆向结论）与 `TRIFLUISNOTE-PLAN.md`
> （开发路线图）；这两份文档属于逆向工作区，未包含在本仓库中。

## 快速开始

直接跑便携版即可（免安装、免配置）：

```
release\Trifluisnote-0.1.0-x64-portable.exe     (103.6 MiB)
```

或者用安装包：

```
release\Trifluisnote-0.1.0-x64-setup.exe        (116.1 MiB)
```

> 预编译的 Windows 产物发布在仓库的 Releases 页面；`release/` 目录不入库，
> 需要在本地复现时按下方「开发」一节执行 `npm run dist` / `npm run dist:portable`。

也可以带上文件路径启动（也可直接双击 `.md` 文件，安装版已注册文件关联）：

```
Trifluisnote.exe D:\notes\my-note.md
```

## v0.1 功能

| 能力 | 说明 |
|---|---|
| 所见即所得 | 输入 Markdown 的同时看到渲染结果；源码 / 所见即所得随时切换（`Ctrl+/`） |
| GFM | 表格、任务列表、删除线、自动链接 |
| 代码高亮 | 190+ 语言，highlight.js 分词 |
| 大纲侧栏 | `Ctrl+Shift+O` 开关，点击标题跳转 |
| 查找 / 替换 | `Ctrl+F`，支持全量替换、区分大小写 |
| 多窗口 | 记事本式：每个窗口一个独立文档，`Ctrl+N` 新建窗口 |
| 导出 | HTML（带主题样式的独立文件）与 PDF（A4，Chromium 排版） |
| 主题 | 6 套，工具栏下拉切换；浅色 / 深色各三套 |
| 其它 | 拖放打开、中文菜单、状态栏字数统计、自动保存标题 |

### 快捷键

| 快捷键 | 动作 |
|---|---|
| `Ctrl+N` | 新建窗口 |
| `Ctrl+Alt+N` | 新建文件（当前窗口） |
| `Ctrl+O` | 打开 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 另存为 |
| `Ctrl+F` | 查找替换 |
| `Ctrl+/` | 源码 / 所见即所得切换 |
| `Ctrl+Shift+O` | 大纲侧栏 |
| `Ctrl+Shift+T` | 切换主题 |
| `Ctrl+W` | 关闭窗口 |

## 开发

```powershell
npm install

npm run dev          # 开发模式（electron-vite）
npm run typecheck    # 类型检查（两个 tsconfig 全绿）
npm run build        # 构建到 out/
npm run start        # 预览构建产物

npm run dist:nsis      # NSIS 安装包
npm run dist:portable  # 单文件便携版
```

### 目录结构

```
src/
├─ core/            编辑器核心层（不依赖 Electron / React）
│  ├─ editor.ts     Milkdown 组装、markdown 读写、统计、查找替换、HTML 序列化
│  ├─ highlight.ts  代码高亮（highlight.js → ProseMirror inline decoration）
│  ├─ outline.ts    大纲提取与跳转
│  └─ task-list.ts  GFM 任务列表的可交互复选框（widget decoration）
├─ main/            Electron 主进程
│  ├─ index.ts      单实例锁、启动、菜单装配
│  ├─ windows.ts    窗口与文档状态（每窗口一文档）
│  ├─ ipc.ts        文件 / 导出 / 状态 IPC
│  ├─ menu.ts       中文菜单
│  └─ export.ts     HTML 模板 + Chromium printToPDF
├─ preload/         contextBridge 暴露的 API
├─ renderer/        React 界面（App / EditorPane / OutlinePanel / FindBar）
└─ shared/          主进程与渲染进程共用
   ├─ types.ts      IPC 类型契约
   └─ theme-css.ts  主题变量 + 文档排版 + 代码配色（渲染层与导出共用）
```

**分层约束**：`src/core/` 不 import 任何 Electron / React API；
`src/shared/theme-css.ts` 里的 CSS 字符串同时被渲染层注入和主进程导出使用，
保证「编辑器里看到的」和「导出的」完全一致。

## 四个踩过的坑（都写在了源码注释里）

这四个都不是「Typora 有而我们没有」的功能问题，而是 Markdown 编辑器内核的共性陷阱，
照着实现时很容易再踩一遍：

1. **内容回灌自激循环**（`src/renderer/App.tsx`）
   Milkdown 的 `markdownUpdated` 回调是 **200ms 防抖**的，载荷是 `latestTr.doc` 的
   序列化结果，**不包含 `appendTransaction` 的产物**（例如 `trailing` 插件补的空段落）；
   而 `readMarkdown(editor)` 读的是当前 state。两者天然可能不相等。
   如果把回调结果写回 state、再用它去驱动编辑器，就会形成
   「改动 → 回灌 → 整篇 `replaceAll` → 再改动」的无限循环 —— 表现为勾选被回滚、
   文档结构被反复重排。
   **解法**：内容通道做成**单向**的。编辑器的变化只写 ref；只有「打开文件 / 新建」
   这类真正的外部替换才会回到 state 并推给编辑器（带自增 token，保证同内容也会重置）。

2. **任务列表复选框「点了没反应」**（`src/core/task-list.ts`）
   两个独立的坑：
   - HTML 规范规定复选框的 `checkedness` 在 click 事件**派发前**翻转（真实点击），
     事件被取消则回滚；而合成的 `el.click()` 走 activation behavior，翻转发生在
     **派发之后**。原生 `<input>` 的翻转时序不受我们控制，
     所以改用 `<span role="checkbox">`，显示完全由文档模型推导。
   - ProseMirror 的 `WidgetType.eq()` 在 `spec.key` 相等时直接判等 → 视图层复用旧 DOM
     → 旧元素上的闭包还持有过期的 `pos` / `attrs`。
     所以用「元素池 + 每次重建手动刷新 `checked` / `data-pos`」，
     点击时再从 `data-pos` 反查**当前** state 里的节点。

3. **保存时把 `-` 列表改写成 `*`**（`src/core/editor.ts`）
   `remark-stringify` v11 的 compiler 是
   `toMarkdown(tree, { ...self.data('settings'), ...options, ... })`，
   `options` 优先级更高，而 Milkdown 恰好把 `remarkStringifyOptionsCtx` 当作 options
   传了进去 —— 所以走 `data('toMarkdown', ...)` 的老写法**根本不生效**。
   正确入口是 `ctx.update(remarkStringifyOptionsCtx, ...)`。

4. **正文留白「点了没反应」**（`src/core/editor.ts` + `src/renderer/EditorPane.tsx`）
   ProseMirror 的 `contenteditable` 只覆盖正文本身，而正文左右两侧的留白、
   正文下方 45vh 的空白都在它**外面**——浏览器不会给这些区域派发编辑事件，
   于是「点击左边空一大片打不进字」「必须精确点到那一行才能编辑」。
   **解法**：在编辑区容器上挂 `mousedown`，当落点不在 `contenteditable` 内时，
   自己把坐标换算成文档位置（先用 `view.posAtCoords()` 精确命中，
   拿不到就按「最近的可编辑块 + 左右」兜底），再 `setSelection` + `focus`。
   行为对齐 Typora：点留白 → 光标落到最近的一行。

## 验证方式

没有 GUI 自动化工具时，用 **CDP 探针**做程序化验证：

```powershell
# 1. 以真实 .md 启动（带调试端口）
#    用便携版 exe：它始终是最新构建，不会像 win-unpacked 那样被运行中的实例锁住
$exe = 'release\Trifluisnote-0.1.0-x64-portable.exe'
Start-Process $exe -ArgumentList @($doc, '--remote-debugging-port=9444')

# 2. 探针：DOM 结构、表格、高亮 token、主题切换、查找栏、控制台错误
node tools\cdp-check2.mjs 9444

# 3. 截图（人工复核中文渲染与排版）
node tools\shot-app.mjs 9444 app-shot.png
```

### 回归测试

两个脚本覆盖「打开文件 → 编辑 → 不保存 → 磁盘不变」这条链路，
以及保存写回的正确性：

```powershell
# 回归：加载 / 勾选 / 不自激 / 磁盘不被改写（14 项）
node tools\cdp-regression.mjs 9444 $env:TEMP\regression-tasklist.md

# 保存链路：勾选 → Ctrl+S → 磁盘写回正确（10 项）
node tools\cdp-save-test.mjs 9445 $env:TEMP\save-test-copy.md
```

开发版、`release\win-unpacked` 与便携版 exe 三者都跑过，**全部 14/14 通过**。

首轮验收的三项修复另有一个专门的回归脚本（真实鼠标事件 + 真实键盘输入）：

```powershell
# 启动带调试端口的实例后：
node tools\verify-fixes.mjs 9222     # 7 项：查找栏开合 / 工具栏行高 / 留白点击落光标
```

导出链路的端到端验证（HTML + PDF 落盘）：

```powershell
node tools\build-export-test.mjs                                   # 单独打出导出模块
electron.exe tools\export-test-main.cjs                            # 生成 HTML / PDF 样张
electron.exe tools\shot-export.cjs <html> <png>                    # 截图复核
```

> ⚠️ 处理中文文本时**不要**用 PowerShell 5.1 的 `Get-Content -Raw`（默认按系统 GBK 解码），
> 会把 UTF-8 中文读成乱码并写坏文件。用 Node 的 `fs.readFileSync(p, 'utf8')`。

样张产物默认落在 `export-test-out/`（可用 `TFN_EXPORT_OUT` 环境变量或脚本第 1 个参数改写输出目录）。

## 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 编辑器内核 | Milkdown 7（ProseMirror + remark） | Markdown 语义原生、schema 可控；不抄 Typora 的 CodeMirror 5（已停维护） |
| 桌面壳 | Electron 45 + electron-vite | 多窗口、菜单、导出 PDF 一条龙 |
| 界面 | React 19 | — |
| 打包 | electron-builder 26 | NSIS + 便携版双形态 |
| 代码高亮 | highlight.js | 纯 JS、无原生依赖；分词后转成 ProseMirror decoration，文档模型保持纯净 |

## 已知限制（v0.1）

- 数学公式（`$…$` / `$$…$$`）尚未渲染，会按纯文本显示
- 图片以相对路径引用，导出 HTML 时不会内嵌图片
- 无自动保存与崩溃恢复
- 无设置持久化（主题选择每次启动回到默认）
- 表格不支持拖拽调整列宽
- 保存时会按 remark 的默认规则规范化排版（例如表格单元格补齐空格、
  有序列表统一编号），与 Typora 的规范化策略不完全一致
