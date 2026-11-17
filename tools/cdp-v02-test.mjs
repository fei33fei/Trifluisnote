// v0.2 回归：标签页 / 自动保存 / 数学公式 / 图片节点
//
// Usage: node cdp-v02-test.mjs <port> <mdFile>
const port = process.argv[2] ?? '9444'
const mdFile = process.argv[3]
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeoutMs = 40000, step = 300) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fn()
      if (r) return r
    } catch {
      /* retry */
    }
    await sleep(step)
  }
  throw new Error('timeout')
}

const target = await waitFor(async () => {
  const res = await fetch(`${base}/json/list`)
  const list = await res.json()
  return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
})

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const consoleErrors = []

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleErrors.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(`exception: ${msg.params.exceptionDetails.text}`)
  }
})

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })

await new Promise((r) => ws.addEventListener('open', r))
await send('Runtime.enable')
await send('Page.enable')

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.result?.exceptionDetails) return { __error: res.result.exceptionDetails.text }
  return res.result?.result?.value
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}

const { existsSync, writeFileSync } = await import('node:fs')
const { dirname, join } = await import('node:path')

/**
 * 每次跑之前都把样张重置一遍。
 *
 * 不重置的话，上一轮粘进去的图片会留在文件里，
 * 下一轮的断言就会对着一份「越来越胖」的文档做，测不出真实问题。
 */
if (mdFile) {
  writeFileSync(
    mdFile,
    `# v0.2 回归样张

行内公式 $E = mc^2$ 与 $a^2 + b^2 = c^2$ 。

块级公式：

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

- [ ] 未勾选的任务
- [x] 已勾选的任务

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

\`\`\`js
console.log('v02')
\`\`\`
`,
    'utf8',
  )
}

await waitFor(async () => (await evaluate(`!!document.querySelector('.ProseMirror')`)) === true)
await sleep(2500)

/* ---------- 1. 标签栏 ---------- */

const tabProbe = await evaluate(`(() => ({
  tabCount: document.querySelectorAll('.tfn-tab').length,
  tabTitles: [...document.querySelectorAll('.tfn-tab__title')].map(t => t.textContent),
  hasTabBar: !!document.querySelector('.tfn-tabbar'),
  hasAddButton: !!document.querySelector('.tfn-tab__new'),
  editorCount: document.querySelectorAll('.ProseMirror').length,
  visiblePanes: document.querySelectorAll('.tfn-editor-pane:not(.is-hidden)').length,
}))()`)
console.log('\n=== 标签栏探针 ===')
console.log(JSON.stringify(tabProbe, null, 2))

check('标签栏存在', tabProbe.hasTabBar === true)
check('初始只有一个标签页', tabProbe.tabCount === 1, `实际 ${tabProbe.tabCount}`)
check('标签页标题是文件名', /tfn-v02-test\.md/.test(tabProbe.tabTitles?.[0] ?? ''), tabProbe.tabTitles?.[0])
check('每个标签页一个编辑器实例', tabProbe.editorCount === tabProbe.tabCount)
check('同时只有一个标签页可见', tabProbe.visiblePanes === 1)

/* ---------- 2. 数学公式 ---------- */

const mathProbe = await evaluate(`(() => ({
  katexNodes: document.querySelectorAll('.katex').length,
  inlineMath: document.querySelectorAll('.tfn-math--inline').length,
  blockMath: document.querySelectorAll('.tfn-math--block').length,
  hasMathML: document.querySelectorAll('.katex math').length,
  firstMathText: document.querySelector('.tfn-math--inline')?.innerText?.trim() ?? '',
}))()`)
console.log('\n=== 数学公式探针 ===')
console.log(JSON.stringify(mathProbe, null, 2))

check('行内公式已渲染', mathProbe.inlineMath >= 2, `行内 ${mathProbe.inlineMath} 个`)
check('块级公式已渲染', mathProbe.blockMath === 1, `块级 ${mathProbe.blockMath} 个`)
check('KaTeX 节点存在', mathProbe.katexNodes >= 3, `katex ${mathProbe.katexNodes} 个`)
check('公式内容正确', /E|=mc/i.test(mathProbe.firstMathText), mathProbe.firstMathText)

/* ---------- 3. 双击公式 → 编辑框改源码 ---------- */

const mathEditProbe = await evaluate(`(() => {
  const el = document.querySelector('.tfn-editor-pane:not(.is-hidden) .tfn-math--inline')
  if (!el) return { ok: false, reason: 'no-math' }
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  return { ok: true }
})()`)
check('双击公式触发编辑框', mathEditProbe.ok === true, mathEditProbe.reason ?? '')
await sleep(800)

const dialogProbe = await evaluate(`(() => {
  const modal = document.querySelector('.tfn-modal')
  const input = modal?.querySelector('.tfn-modal__input')
  return {
    hasModal: !!modal,
    value: input ? input.value : null,
    hasPreview: !!modal?.querySelector('.tfn-modal__preview .katex'),
  }
})()`)
console.log('\n=== 公式编辑框探针 ===')
console.log(JSON.stringify(dialogProbe, null, 2))

check('弹出公式编辑框', dialogProbe.hasModal === true)
check(
  '编辑框里是当前 LaTeX 源码',
  /E\s*=\s*m/.test(dialogProbe.value ?? ''),
  dialogProbe.value ?? '',
)
check('编辑框有实时预览', dialogProbe.hasPreview === true)

// 改成别的公式并确定
await evaluate(`(() => {
  const input = document.querySelector('.tfn-modal__input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(input, 'E = m c^2')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(400)
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.tfn-modal__actions button')].find(b => b.textContent.trim() === '确定')
  btn.click()
  return true
})()`)
await sleep(1200)

const afterEdit = await evaluate(`(() => {
  const el = document.querySelector('.tfn-editor-pane:not(.is-hidden) .tfn-math--inline')
  return { attr: el ? el.getAttribute('data-math-inline') : null, text: el ? el.innerText.replace(/\\n/g, '') : null }
})()`)
check('公式源码已更新', (afterEdit.attr ?? '').includes('m c^2'), afterEdit.attr ?? '')
check('公式重新渲染', (afterEdit.text ?? '').includes('m'), afterEdit.text ?? '')

/* ---------- 4. 粘贴图片 → 落盘到 assets/ ---------- */

const pasteProbe = await evaluate(`(() => {
  const pm = document.querySelector('.tfn-editor-pane:not(.is-hidden) .ProseMirror')
  if (!pm) return { ok: false, reason: 'no-editor' }
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'pasted.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  pm.dispatchEvent(ev)
  return { ok: true }
})()`)
check('模拟粘贴图片已派发', pasteProbe.ok === true, pasteProbe.reason ?? '')
await sleep(2500)

const imageProbe = await evaluate(`(() => {
  const pm = document.querySelector('.tfn-editor-pane:not(.is-hidden) .ProseMirror')
  // 注意：ProseMirror 会在原子节点前面插一个占位的 hack <img>（没有 src），
  // 所以要看真正带 src 的那个
  const imgs = pm ? [...pm.querySelectorAll('img')] : []
  const real = imgs.filter((i) => i.getAttribute('src'))
  return {
    imgCount: imgs.length,
    hasImg: real.length > 0,
    src: real.length ? real[0].getAttribute('src') : null,
  }
})()`)
console.log('\n=== 图片落盘探针 ===')
console.log(JSON.stringify(imageProbe, null, 2))

check('编辑器里出现图片节点', imageProbe.hasImg === true)
check(
  '图片按文档目录解析成 file:// 地址',
  typeof imageProbe.src === 'string' && imageProbe.src.startsWith('file://'),
  imageProbe.src ?? '',
)

const pasted = join(dirname(mdFile), 'assets', 'pasted.png')
check('图片落到文档旁边的 assets/', existsSync(pasted), pasted)

/* ---------- 4. 源码模式往返 ---------- */

// 用工具栏按钮切源码模式（Ctrl+/ 是原生菜单快捷键，合成 keydown 触发不了）
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.tfn-toolbar button')].find(b => b.textContent.trim() === '源码模式')
  if (btn) btn.click()
  return true
})()`)
await sleep(1200)

const sourceProbe = await evaluate(`(() => {
  const ta = document.querySelector('.tfn-editor-pane:not(.is-hidden) .tfn-source')
  return { hasTextarea: !!ta, value: ta ? ta.value : '' }
})()`)
check('切到源码模式', sourceProbe.hasTextarea === true)
check(
  '行内公式源码原样保留',
  /\$\s*E\s*=\s*m\s*c\s*\^2\s*\$/.test(sourceProbe.value),
  sourceProbe.value.slice(0, 60).replace(/\n/g, '⏎'),
)
check('块级公式源码原样保留', sourceProbe.value.includes('$$'))

/* ---------- 5. 自动保存 ---------- */

const marker = 'AUTO-SAVE-V02'
await evaluate(`(() => {
  const ta = document.querySelector('.tfn-editor-pane:not(.is-hidden) .tfn-source')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, ta.value + '\\n\\n${marker}')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(1200)

const dirtyProbe = await evaluate(
  `(document.querySelector('.tfn-toolbar__title')?.textContent ?? '').includes('•')`,
)
check('改动后标记为已修改', dirtyProbe === true)

// 等渲染层推送（1.5s）+ 主进程落盘（2s）
await sleep(6000)

const { readFileSync } = await import('node:fs')
const onDisk = readFileSync(mdFile, 'utf8')
check('自动保存把内容写回磁盘', onDisk.includes(marker), onDisk.includes(marker) ? '磁盘已更新' : '磁盘未更新')

const afterSave = await evaluate(`(() => ({
  dirty: (document.querySelector('.tfn-toolbar__title')?.textContent ?? '').includes('•'),
  status: document.querySelector('.tfn-statusbar')?.innerText ?? '',
}))()`)
check('自动保存后清除已修改标记', afterSave.dirty === false)
check('状态栏显示已自动保存', /已自动保存/.test(afterSave.status), afterSave.status.replace(/\n/g, ' | '))

/* ---------- 6. 新标签页 ---------- */

await evaluate(`(() => {
  document.querySelector('.tfn-tab__new').click()
  return true
})()`)
await sleep(1500)

const newTabProbe = await evaluate(`(() => ({
  tabCount: document.querySelectorAll('.tfn-tab').length,
  editorCount: document.querySelectorAll('.ProseMirror').length,
  visiblePanes: document.querySelectorAll('.tfn-editor-pane:not(.is-hidden)').length,
  activeIndex: [...document.querySelectorAll('.tfn-tab')].findIndex(t => t.classList.contains('is-active')),
  titles: [...document.querySelectorAll('.tfn-tab__title')].map(t => t.textContent),
}))()`)
console.log('\n=== 新标签页探针 ===')
console.log(JSON.stringify(newTabProbe, null, 2))

check('新建标签页后有两个标签页', newTabProbe.tabCount === 2, `实际 ${newTabProbe.tabCount}`)
check('两个标签页各自有编辑器', newTabProbe.editorCount === 2, `实际 ${newTabProbe.editorCount}`)
check('仍然只有一个标签页可见', newTabProbe.visiblePanes === 1)
check('新标签页被激活', newTabProbe.activeIndex === 1)

/* ---------- 7. 标签页之间内容隔离 ---------- */

await evaluate(`(() => {
  const ta = document.querySelector('.tfn-editor-pane:not(.is-hidden) .tfn-source')
  if (!ta) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '新标签页的内容')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(800)

// 切回第一个标签页
await evaluate(`(() => {
  document.querySelectorAll('.tfn-tab')[0].click()
  return true
})()`)
await sleep(1200)

const isolation = await evaluate(`(() => {
  const ta = document.querySelector('.tfn-editor-pane:not(.is-hidden) .tfn-source')
  return { value: ta ? ta.value : '' }
})()`)
check(
  '切回原标签页内容未被污染',
  isolation.value.includes(marker) && !isolation.value.includes('新标签页的内容'),
)

/* ---------- 8. 控制台 ---------- */

check('控制台无错误 / 警告', consoleErrors.length === 0, consoleErrors.join(' | ') || '(无)')

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)

ws.close()
process.exit(failed.length ? 1 : 0)
