/**
 * KaTeX 的样式表（以字符串形式拿到）。
 *
 * 编辑器里由 main.tsx 直接 `import 'katex/dist/katex.min.css'` 引入；
 * 导出 HTML / PDF 时则需要同一份 CSS 的文本 ——
 * 导出的 HTML 里公式是 KaTeX 渲染好的标记，没有样式就是一堆乱码。
 */
import katexCss from 'katex/dist/katex.min.css?raw'

export const KATEX_CSS: string = katexCss
