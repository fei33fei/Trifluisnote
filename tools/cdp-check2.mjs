// 通过 CDP 验证 Trifluisnote v0.1 的功能面
// Usage: node cdp-check2.mjs <port>
const port = process.argv[2] ?? '9333'
const base = `http://127.0.0.1:${port}`

async function waitFor(fn, timeoutMs = 40000, step = 400) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fn()
      if (r) return r
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, step))
  }
  throw new Error('timeout')
}

const targets = await waitFor(async () => {
  const res = await fetch(`${base}/json/list`)
  const list = await res.json()
  return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
})

console.log('target:', targets.title, '|', targets.url)

const ws = new WebSocket(targets.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const consoleErrors = []

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleErrors.push(
      `${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`,
    )
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(
      `exception: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`,
    )
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
  if (res.result?.exceptionDetails) {
    return { error: res.result.exceptionDetails.text }
  }
  return res.result?.result?.value
}

await new Promise((r) => setTimeout(r, 3000))

const probe = await evaluate(`(() => {
  const pm = document.querySelector('.ProseMirror')
  const app = document.querySelector('.tfn-app')
  const toolbar = document.querySelector('.tfn-toolbar')
  const status = document.querySelector('.tfn-statusbar')
  const doc = document.querySelector('.tfn-doc')
  const hljsSpans = pm ? pm.querySelectorAll('span[class^="hljs-"]') : []
  const hljsClasses = [...new Set([...hljsSpans].map(s => s.className))].slice(0, 12)
  return {
    hasApp: !!app,
    hasToolbar: !!toolbar,
    hasStatusbar: !!status,
    hasProseMirror: !!pm,
    hasDocWrapper: !!doc,
    theme: document.documentElement.dataset.theme,
    hasContentStyle: !!document.getElementById('tfn-content-style'),
    headings: pm ? [...pm.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ':' + h.innerText).slice(0,8) : [],
    listItems: pm ? pm.querySelectorAll('li').length : 0,
    taskCheckboxes: pm ? pm.querySelectorAll('input[type=checkbox]').length : 0,
    codeBlocks: pm ? pm.querySelectorAll('pre').length : 0,
    codeLang: pm ? (pm.querySelector('pre')?.getAttribute('data-language') ?? null) : null,
    hljsTokenCount: hljsSpans.length,
    hljsClasses,
    tables: pm ? pm.querySelectorAll('table').length : 0,
    tableCells: pm ? pm.querySelectorAll('th,td').length : 0,
    toolbarButtons: toolbar ? [...toolbar.querySelectorAll('button')].map(b => b.textContent.trim()) : [],
    themeSelect: toolbar?.querySelector('select')?.value ?? null,
    themeOptions: toolbar?.querySelector('select') ? [...toolbar.querySelector('select').options].map(o=>o.value) : [],
    statusText: status ? status.innerText.replace(/\\n/g, ' | ') : null,
    title: document.title,
  }
})()`)

console.log('\n=== DOM 探针 ===')
console.log(JSON.stringify(probe, null, 2))

// 打开大纲侧栏
const outlineProbe = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.tfn-toolbar button')].find(b => b.textContent.trim() === '查找')
  void btn
  return { hasToggle: !!document.querySelector('.tfn-outline-toggle') }
})()`)
console.log('\n=== 大纲入口 ===')
console.log(JSON.stringify(outlineProbe))

// 点击「查找」按钮，验证查找栏
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.tfn-toolbar button')].find(b => b.textContent.trim() === '查找')
  if (btn) btn.click()
  return true
})()`)
await new Promise((r) => setTimeout(r, 600))
const findProbe = await evaluate(`(() => {
  const bar = document.querySelector('.tfn-findbar')
  return { hasFindBar: !!bar, inputs: bar ? bar.querySelectorAll('input').length : 0 }
})()`)
console.log('\n=== 查找栏 ===')
console.log(JSON.stringify(findProbe))

// 切换主题，验证 CSS 变量跟着变
const themeProbe = await evaluate(`(() => {
  const sel = document.querySelector('.tfn-toolbar select')
  const before = getComputedStyle(document.documentElement).getPropertyValue('--tfn-bg').trim()
  sel.value = 'github-dark'
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return { before, after: sel.value }
})()`)
await new Promise((r) => setTimeout(r, 800))
const themeAfter = await evaluate(`(() => ({
  theme: document.documentElement.dataset.theme,
  bg: getComputedStyle(document.documentElement).getPropertyValue('--tfn-bg').trim(),
  bodyBg: getComputedStyle(document.body).backgroundColor,
}))()`)
console.log('\n=== 主题切换 ===')
console.log(JSON.stringify({ ...themeProbe, ...themeAfter }))

console.log('\n=== 控制台错误/警告 ===')
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(无)')

ws.close()
process.exit(0)
