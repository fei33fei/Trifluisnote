/**
 * 端到端验证导出：生成 HTML 与 PDF 两个文件。
 * 由 Electron 运行时执行（需要 BrowserWindow.printToPDF）。
 */

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { buildExportHtml, renderPdf } = require('../tmp-export-test/export-test.cjs')

// 产物目录：默认写到仓库内的 export-test-out/，可用环境变量或第 1 个参数覆盖
// （避免把开发机的绝对路径写死在仓库里）
const OUT_DIR = process.argv[2] || process.env.TFN_EXPORT_OUT || path.join(process.cwd(), 'export-test-out')

const HTML = `
<h1>Trifluisnote 导出验证</h1>
<p>段落文本，含 <strong>粗体</strong> 与 <a href="https://example.com">链接</a>。</p>
<ul><li>列表项一</li><li>列表项二</li></ul>
<ul>
  <li data-item-type="task" data-label="•" data-list-type="bullet" data-spread="true" data-checked="false"><p>未勾选的任务</p></li>
  <li data-item-type="task" data-label="•" data-list-type="bullet" data-spread="true" data-checked="true"><p>已勾选的任务</p></li>
</ul>
<blockquote>引用块</blockquote>
<pre data-language="js"><code class="language-js">console.log('hello')</code></pre>
<table><thead><tr><th>列 A</th><th>列 B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
`

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true })

    const payload = { html: HTML, theme: 'github-dark', title: '导出验证' }

    const html = buildExportHtml(payload)
    const htmlPath = path.join(OUT_DIR, 'export-test.html')
    fs.writeFileSync(htmlPath, html, 'utf8')
    console.log('[x] HTML ->', htmlPath, html.length, 'chars')

    const pdf = await renderPdf(payload)
    const pdfPath = path.join(OUT_DIR, 'export-test.pdf')
    fs.writeFileSync(pdfPath, pdf)
    console.log('[x] PDF  ->', pdfPath, pdf.length, 'bytes')
    console.log('[x] PDF magic =', pdf.subarray(0, 5).toString('latin1'))

    app.exit(0)
  } catch (err) {
    console.log('[!] FAILED:', err && err.stack ? err.stack : err)
    app.exit(1)
  }
})
