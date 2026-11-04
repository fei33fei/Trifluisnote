# Trifluisnote

![Trifluisnote 主界面](docs/screenshot.png)

> **所见即所得的 Markdown 桌面编辑器** —— 本地、开箱即用。

[![version](https://img.shields.io/badge/version-v0.1.0-2ea44f?style=flat-square)](https://github.com/fei33fei/Trifluisnote/releases)
[![license](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)](./LICENSE)
![platform](https://img.shields.io/badge/platform-Windows%20x64-0078d4?style=flat-square)
![electron](https://img.shields.io/badge/Electron-45-47848F?style=flat-square)
![react](https://img.shields.io/badge/React-19-61dafb?style=flat-square)

输入 Markdown 的同时看到渲染结果，源码模式与所见即所得共用同一份文档模型。
**纯本地运行：文件不出本机，不联网，不订阅。**

## 目录

- [为什么做这个](#为什么做这个)
- [特性](#特性)
- [快速开始](#快速开始)
- [打开本地已有的 md 文件](#打开本地已有的-md-文件)
- [v0.1 功能](#v01-功能)
- [快捷键](#快捷键)
- [开发](#开发)
- [架构](#架构)
- [实现要点](#实现要点五个踩过的坑)
- [验证](#验证)
- [技术选型](#技术选型)
- [已知限制](#已知限制)
- [许可证](#许可证)

## 为什么做这个

市面上的 Markdown 编辑器大多要么收费订阅、要么要联网登录，要么在中文排版和老文件编码上反复翻车。
想写点东西而已，却要先解决一堆前置条件。

Trifluisnote 是为自己写的一个编辑器，目标很直接：

- **打开就能写** —— 下载即用，不联网、不登录。
- **所见即所得，但要可信** —— 渲染结果和源码必须是同一份文档的两种视图，不会出现「预览和源码对不上」。
- **不弄丢用户的文件** —— 老文件是什么编码，保存时就还是什么编码；格式该是什么样，保存后就还是什么样。
- **可自己改** —— 代码结构清晰，四层分层，核心层不依赖 Electron / React，可以单独拿去用。

## 特性

| | |
|---|---|
| 🖊️ **所见即所得** | 输入即渲染，`Ctrl+/` 随时切回源码模式 |
| 📋 **GFM 完整支持** | 表格、任务列表、删除线、自动链接 |
| 🎨 **代码高亮** | 190+ 语言（highlight.js），主题随配色切换 |
| 🗂️ **大纲侧栏** | `Ctrl+Shift+O` 开关，点击标题跳转 |
| 🔍 **查找替换** | `Ctrl+F`，支持全量替换与区分大小写 |
| 🪟 **多窗口** | 记事本式，每窗口一个独立文档 |
| 📤 **导出** | HTML（独立文件，带主题样式）/ PDF（A4，Chromium 排版） |
| 🎨 **主题** | 6 套，浅色 / 深色各三套 |
| 🧩 **编码兼容** | UTF-8 / UTF-8 BOM / UTF-16 / GBK，读时探测、写时按原编码回写 |
| 🔗 **文件关联** | 安装版注册 `.md` 关联，右键「打开方式」直接进 |

## 快速开始

到 [Releases](https://github.com/fei33fei/Trifluisnote/releases) 下载 Windows 版本：

| 版本 | 文件 | 说明 |
|---|---|---|
| 便携版 | `Trifluisnote-0.1.0-x64-portable.exe` | 免安装，双击即用，适合试用 |
| 安装版 | `Trifluisnote-0.1.0-x64-setup.exe` | NSIS 安装包，已注册 `.md` 文件关联 |

> `release/` 目录不入库（单个产物 100MB+，超过 GitHub 单文件上限），需要在本地复现时按
> [开发](#开发) 一节执行 `npm run dist:portable` / `npm run dist:nsis`。

也可以带上文件路径启动：

```
Trifluisnote.exe D:\notes\my-note.md
```

## 打开本地已有的 md 文件

装完之后有四条路都能打开本地文件，任意一条都走同一套主进程读取逻辑
（所以编码探测、绝对路径、错误提示的行为完全一致）：

| 方式 | 说明 |
|---|---|
| 双击 `.md` 文件 | 安装版注册了文件关联（`.md` → `Trifluisnote.exe "%1"`） |
| 右键 → 打开方式 → Trifluisnote | 安装器会写 `Applications\Trifluisnote.exe`，所以这个应用**出现在「打开方式」列表里** |
| 拖进窗口 | 走主进程读取，不是渲染层自己读 |
| `Ctrl+O` / 工具栏「打开」 | 文件选择框 |

> electron-builder 自带的 `APP_ASSOCIATE` 宏只写「扩展名 → ProgID → 打开命令」，
> **不写** `Applications\<exe>`。少了这一项应用就不在「打开方式」列表里，
> 用户右键 md 文件根本找不到它。补写这段注册的是 `build/installer.nsh`。

### 编码：老文件不是 UTF-8 也能正常打开

国内用户手上「原本就有」的 md 文件绝大多数是 **GBK/GB18030**（记事本、Word 另存、
老工具导出都是这个编码）。按 UTF-8 硬解会整篇乱码，用户看到的就是「文件打不开」。

所以 Trifluisnote 读文件时会先探 BOM、再试严格 UTF-8、失败才退 GBK；
**保存时按读出来时的原编码写回去**，不会把用户的 GBK 文件悄悄改成 UTF-8。
当前文件的编码显示在状态栏里（`UTF-8` / `UTF-8 (BOM)` / `GBK` / `UTF-16 LE`）。

> 唯一例外是「另存为」——那是一个新文件，统一写成无 BOM 的 UTF-8。

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

要求 Node ≥ 18、npm ≥ 9；Windows 上打包需要 WebView2 与 .NET Framework 4.8（electron-builder 的 NSIS 依赖）。

## 架构

四层，依赖方向自上而下，核心层不碰任何平台 API：

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
│  ├─ encoding.ts   文件编码探测与回写（UTF-8 / BOM / UTF-16 / GBK）
│  └─ export.ts     HTML 模板 + Chromium printToPDF
├─ preload/         contextBridge 暴露的 API
├─ renderer/        React 界面（App / EditorPane / OutlinePanel / FindBar）
└─ shared/          主进程与渲染进程共用
   ├─ types.ts      IPC 类型契约
   ├─ encoding.ts   编码名显示（状态栏）
   └─ theme-css.ts  主题变量 + 文档排版 + 代码配色（渲染层与导出共用）
```

打包相关的两个文件：

```
build/
├─ icon.ico / md.ico   应用图标 / 文件关联图标
└─ installer.nsh        补写 Applications\<exe> 注册项（让应用出现在「打开方式」里）
```

**分层约束**：`src/core/` 不 import 任何 Electron / React API；
`src/shared/theme-css.ts` 里的 CSS 字符串同时被渲染层注入和主进程导出使用，
保证「编辑器里看到的」和「导出的」完全一致。

## 实现要点：五个踩过的坑

这五个都不是功能取舍问题，而是 Markdown 编辑器内核的共性陷阱，
照着实现时很容易再踩一遍（对应源码里都有注释）：

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
   行为上：点留白 → 光标落到最近的一行。

5. **老 md 文件「打不开」（其实是乱码）**（`src/main/encoding.ts`）
   `readFileSync(path, 'utf8')` 对 GBK 文件不会报错，只会解出一篇乱码 ——
   而「打不开文件」正是用户对乱码最常见的描述。
   Node 的 `Buffer.from(str, 'gbk')` 不存在（只能解码不能编码），
   所以 GBK 的**回写**必须靠 `iconv-lite`；只解码的话 Node 自带的
   `TextDecoder('gbk')` 就够了（Electron 带完整 ICU）。
   规矩：**读时探编码，写时按原编码写回**，绝不擅自改用户文件的编码。
   另外，拖放打开原来是在渲染层用 `FileReader` 读的（只有 UTF-8），
   现在统一交给主进程，避免两条路径行为不一致。

## 验证

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

打开链路与编码的端到端回归（自己拉起应用、自造 UTF-8 / UTF-8 BOM / GBK 三种夹具）：

```powershell
node tools\cdp-open-test.mjs        # 8 项：正文正确 / BOM 不残留 / GBK 不乱码 / 保存后仍是 GBK / 窗口标题带文件名
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
| 编辑器内核 | Milkdown 7（ProseMirror + remark） | Markdown 语义原生、schema 可控；未采用已停维护的 CodeMirror 5 |
| 桌面壳 | Electron 45 + electron-vite | 多窗口、菜单、导出 PDF 一条龙 |
| 界面 | React 19 | — |
| 打包 | electron-builder 26 | NSIS + 便携版双形态 |
| 代码高亮 | highlight.js | 纯 JS、无原生依赖；分词后转成 ProseMirror decoration，文档模型保持纯净 |
| 编码转换 | iconv-lite | GBK 回写必须靠它（Node 只能解码不能编码） |

## 已知限制（v0.1）

- 数学公式（`$…$` / `$$…$$`）尚未渲染，会按纯文本显示
- 图片以相对路径引用，导出 HTML 时不会内嵌图片
- 无自动保存与崩溃恢复
- 无设置持久化（主题选择每次启动回到默认）
- 表格不支持拖拽调整列宽
- 保存时会按 remark 的默认规则规范化排版（例如表格单元格补齐空格、
  有序列表统一编号），与部分 Markdown 工具的规范化策略不完全一致

## 许可证

[MIT](LICENSE) © Fey
