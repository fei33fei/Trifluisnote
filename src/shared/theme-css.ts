/**
 * 文档内容样式与主题。
 *
 * 这里用「TS 模块里的 CSS 字符串」而不是 .css 文件，
 * 是因为主进程（Node 侧，做 HTML/PDF 导出）也需要同一份样式表；
 * 放在文件里主进程就得额外处理 CSS 加载，做成字符串最省事。
 *
 * 渲染层在 main.tsx 里把 THEME_CSS 注入 <style>，
 * 导出时主进程把同一段 CSS 拼进导出的 HTML —— 两边永远一致。
 */

export interface ThemeMeta {
  id: string
  name: string
  /** 是否为深色底（影响状态栏图标等） */
  dark: boolean
}

export const THEMES: ThemeMeta[] = [
  { id: 'github-light', name: 'GitHub 浅色', dark: false },
  { id: 'github-dark', name: 'GitHub 深色', dark: true },
  { id: 'newsprint', name: '报刊', dark: false },
  { id: 'sepia', name: '羊皮纸', dark: false },
  { id: 'midnight', name: '午夜', dark: true },
  { id: 'forest', name: '林间', dark: true },
]

export const DEFAULT_THEME = 'github-light'

/**
 * 变量约定：
 *  --tfn-bg         页面底色
 *  --tfn-fg         正文前景色
 *  --tfn-muted      次要文字（引用、表格边框）
 *  --tfn-border     分隔线 / 表格边框
 *  --tfn-accent     强调色（链接）
 *  --tfn-code-bg    代码块底色
 *  --tfn-select     选区底色
 *  --tfn-quote-bar  引用块左边条
 */
const THEME_VARS = `
[data-theme='github-light'] {
  --tfn-bg: #ffffff;
  --tfn-fg: #1f2328;
  --tfn-muted: #59636e;
  --tfn-border: #d1d9e0;
  --tfn-accent: #0969da;
  --tfn-code-bg: #f6f8fa;
  --tfn-select: #b6d7ff;
  --tfn-quote-bar: #d1d9e0;
}
[data-theme='github-dark'] {
  --tfn-bg: #0d1117;
  --tfn-fg: #e6edf3;
  --tfn-muted: #9198a1;
  --tfn-border: #3d444d;
  --tfn-accent: #4493f8;
  --tfn-code-bg: #151b23;
  --tfn-select: #264f78;
  --tfn-quote-bar: #3d444d;
}
[data-theme='newsprint'] {
  --tfn-bg: #fbfbf7;
  --tfn-fg: #1a1a1a;
  --tfn-muted: #6b6b6b;
  --tfn-border: #d8d4c8;
  --tfn-accent: #8a5a2b;
  --tfn-code-bg: #f2efe6;
  --tfn-select: #d8e6c0;
  --tfn-quote-bar: #c8c2b0;
}
[data-theme='sepia'] {
  --tfn-bg: #f4ecd8;
  --tfn-fg: #433422;
  --tfn-muted: #7b6a52;
  --tfn-border: #d9c9a8;
  --tfn-accent: #9a5b2a;
  --tfn-code-bg: #ebe0c8;
  --tfn-select: #d3c69e;
  --tfn-quote-bar: #c8b58c;
}
[data-theme='midnight'] {
  --tfn-bg: #101420;
  --tfn-fg: #d7dced;
  --tfn-muted: #7f8aa8;
  --tfn-border: #2a3350;
  --tfn-accent: #7aa2f7;
  --tfn-code-bg: #171d2c;
  --tfn-select: #2c3a5c;
  --tfn-quote-bar: #2a3350;
}
[data-theme='forest'] {
  --tfn-bg: #101a14;
  --tfn-fg: #d5e3d8;
  --tfn-muted: #7e958a;
  --tfn-border: #24382c;
  --tfn-accent: #7fb069;
  --tfn-code-bg: #16241b;
  --tfn-select: #2a4433;
  --tfn-quote-bar: #24382c;
}
`

/** highlight.js token 配色（跟随主题变量，浅/深色都可用）。 */
const TOKEN_VARS = `
.hljs-comment, .hljs-quote { color: var(--tfn-muted); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-doctag, .hljs-formula { color: #cf222e; }
.hljs-string, .hljs-regexp, .hljs-addition, .hljs-attribute, .hljs-meta .hljs-string { color: #0a3069; }
.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-link, .hljs-meta, .hljs-selector-id { color: #0550ae; }
.hljs-title, .hljs-section, .hljs-name, .hljs-title.class_, .hljs-title.function_ { color: #8250df; }
.hljs-type, .hljs-class .hljs-title, .hljs-built_in, .hljs-builtin-name, .hljs-params { color: #953800; }
.hljs-variable, .hljs-template-variable, .hljs-tag, .hljs-selector-attr, .hljs-selector-pseudo { color: #116329; }
.hljs-deletion { color: #82071e; background: #ffebe9; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
`

/** 文档正文排版（编辑器内与导出共用）。 */
const CONTENT_CSS = `
:root {
  --tfn-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC',
    'WenQuanYi Micro Hei', Roboto, Helvetica, Arial, sans-serif;
  --tfn-font-mono: 'Cascadia Code', 'JetBrains Mono', 'SFMono-Regular', Consolas,
    'Liberation Mono', Menlo, 'Noto Sans Mono CJK SC', monospace;
}
.tfn-doc {
  color: var(--tfn-fg);
  font-family: var(--tfn-font-sans);
  font-size: 16px;
  line-height: 1.75;
  word-wrap: break-word;
}
.tfn-doc ::selection { background: var(--tfn-select); }
.tfn-doc h1, .tfn-doc h2, .tfn-doc h3,
.tfn-doc h4, .tfn-doc h5, .tfn-doc h6 {
  margin: 1.6em 0 0.7em;
  line-height: 1.3;
  font-weight: 600;
}
.tfn-doc h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--tfn-border); }
.tfn-doc h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--tfn-border); }
.tfn-doc h3 { font-size: 1.25em; }
.tfn-doc h4 { font-size: 1em; }
.tfn-doc h5 { font-size: 0.875em; }
.tfn-doc h6 { font-size: 0.85em; color: var(--tfn-muted); }
.tfn-doc p { margin: 0.9em 0; }
.tfn-doc a { color: var(--tfn-accent); text-decoration: none; }
.tfn-doc a:hover { text-decoration: underline; }
.tfn-doc ul, .tfn-doc ol { margin: 0.8em 0; padding-left: 1.8em; }
.tfn-doc li { margin: 0.3em 0; }
.tfn-doc li > p { margin: 0.2em 0; }
.tfn-doc blockquote {
  margin: 1em 0;
  padding: 0.2em 1em;
  color: var(--tfn-muted);
  border-left: 0.25em solid var(--tfn-quote-bar);
}
.tfn-doc hr { height: 1px; margin: 1.6em 0; border: 0; background: var(--tfn-border); }
.tfn-doc img { max-width: 100%; border-radius: 4px; }
.tfn-doc code {
  font-family: var(--tfn-font-mono);
  font-size: 0.875em;
  padding: 0.2em 0.4em;
  border-radius: 4px;
  background: var(--tfn-code-bg);
}
.tfn-doc pre {
  margin: 1em 0;
  padding: 0.9em 1.1em;
  overflow: auto;
  border-radius: 6px;
  background: var(--tfn-code-bg);
  border: 1px solid var(--tfn-border);
  position: relative;
}
.tfn-doc pre code {
  padding: 0;
  background: none;
  font-size: 0.85em;
  line-height: 1.6;
  white-space: pre;
}.tfn-doc pre[data-language]::before {
  content: attr(data-language);
  position: absolute;
  top: 0;
  right: 0;
  padding: 0.15em 0.6em;
  font-size: 0.7em;
  color: var(--tfn-muted);
  background: var(--tfn-border);
  border-bottom-left-radius: 6px;
  opacity: 0.75;
}
.tfn-doc table {
  border-collapse: collapse;
  margin: 1em 0;
  display: block;
  width: max-content;
  max-width: 100%;
  overflow: auto;
}
.tfn-doc th, .tfn-doc td {
  border: 1px solid var(--tfn-border);
  padding: 0.45em 0.85em;
}
.tfn-doc th { background: var(--tfn-code-bg); font-weight: 600; }
.tfn-doc tr:nth-child(2n) td { background: color-mix(in srgb, var(--tfn-code-bg) 45%, transparent); }
.tfn-doc input[type='checkbox'] { margin-right: 0.4em; }
.tfn-doc li[data-item-type='task'] {
  list-style: none;
}
.tfn-doc li[data-item-type='task'] > p:first-child {
  padding-left: 1.5em;
  text-indent: -1.5em;
}
.tfn-doc li[data-item-type='task'] > p:first-child > .tfn-task__checkbox {
  display: inline-block;
  width: 1.1em;
  margin: 0 0.4em 0 0;
  text-align: center;
  vertical-align: -0.12em;
  cursor: pointer;
  user-select: none;
  color: var(--tfn-accent);
}
/*
 * 导出的静态 HTML 来自 DOMSerializer，里面没有 widget 控件，
 * 改用伪元素补一个（编辑器里则由 .tfn-task__checkbox 承担，
 * 两边靠 .tfn-doc--static 区分，不会重复渲染）。
 */
.tfn-doc--static li[data-item-type='task'] > p:first-child::before {
  content: '☐';
  display: inline-block;
  width: 1.1em;
  margin-right: 0.4em;
  text-align: center;
  vertical-align: -0.12em;
  color: var(--tfn-accent);
}
.tfn-doc--static li[data-item-type='task'][data-checked='true'] > p:first-child::before {
  content: '☑';
}
.tfn-doc .footnotes { margin-top: 2.5em; border-top: 1px solid var(--tfn-border); font-size: 0.9em; }
`

export const THEME_CSS = `${THEME_VARS}${TOKEN_VARS}${CONTENT_CSS}`
