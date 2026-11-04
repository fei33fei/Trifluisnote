// 验证保存路径：勾选复选框 → Ctrl+S → 磁盘文件被正确写回
//
// Usage: node cdp-save-test.mjs <port> <mdFile>
import { readFileSync } from 'node:fs'

const port = process.argv[2] ?? '9445'
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

await waitFor(async () => (await evaluate(`!!document.querySelector('.ProseMirror')`)) === true)
await sleep(2500)

const before = readFileSync(mdFile, 'utf8')

// 勾选第一个任务项
await evaluate(`(() => {
  const cb = document.querySelector('.ProseMirror li[data-item-type="task"] .tfn-task__checkbox')
  cb.click()
  return true
})()`)
await sleep(900)

const dirtyBefore = await evaluate(
  `(document.querySelector('.tfn-toolbar__title')?.textContent ?? '').includes('•')`,
)
check('勾选后标记为已修改', dirtyBefore === true)

// 触发 Ctrl+S
await evaluate(`(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
  return true
})()`)
await sleep(1200)

const dirtyAfter = await evaluate(
  `(document.querySelector('.tfn-toolbar__title')?.textContent ?? '').includes('•')`,
)
check('保存后「已修改」标记清除', dirtyAfter === false)

const after = readFileSync(mdFile, 'utf8')
console.log('\n--- 磁盘文件内容 ---\n' + after + '\n----------------------')

check('文件内容已写回', after !== before)
check('任务项状态写回正确', /- \[x\] 未勾选的任务/.test(after))
check('未勾选项保持未勾选', /- \[ \] 第三个任务/.test(after))
check('无序列表符号保持 `-`', /^- \[x\] 未勾选的任务$/m.test(after) && !/\n\* /.test(after))
check('表格结构保留', after.includes('| 列 A | 列 B |'))
check('代码块保留', after.includes('```js'))
check('没有混入 HTML 残留', !/<br\s*\/?>/i.test(after) && !/<\/p>/i.test(after))
check('控制台无错误 / 警告', consoleErrors.length === 0, consoleErrors.join(' | ') || '(无)')

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)

ws.close()
process.exit(failed.length ? 1 : 0)
