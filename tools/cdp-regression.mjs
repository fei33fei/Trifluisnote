// 回归验证：content 反馈回路 / 任务列表复选框 / 磁盘文件不被意外改写
//
// Usage: node cdp-regression.mjs <port> <mdFile>
//
// 检查项：
//  1. 打开文件后内容正确加载（源码模式读 textarea）
//  2. 点击任务列表复选框 → 模型与 DOM 同时翻转，markdown 里 [ ] ↔ [x]
//  3. 不自激：等待后文档结构（段落数）保持稳定
//  4. 磁盘文件不被意外改写（sha256 前后一致）
//  5. 控制台无错误 / 警告
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const port = process.argv[2] ?? '9444'
const mdFile = process.argv[3]
const base = `http://127.0.0.1:${port}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function hashFile(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex')
}

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

const targets = await waitFor(async () => {
  const res = await fetch(`${base}/json/list`)
  const list = await res.json()
  return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
})

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
    return { __error: res.result.exceptionDetails.text }
  }
  return res.result?.result?.value
}

/** 切换到源码模式并读回当前 markdown */
const readMarkdownViaSource = async () => {
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.tfn-toolbar button')]
      .find(b => b.textContent.trim() === '源码模式')
    if (btn) btn.click()
    return true
  })()`)
  await sleep(500)
  const md = await evaluate(`document.querySelector('.tfn-source')?.value ?? null`)
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.tfn-toolbar button')]
      .find(b => b.textContent.trim() === '所见即所得')
    if (btn) btn.click()
    return true
  })()`)
  await sleep(500)
  return md
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}

/* ---------------- 0. 初始状态 ---------------- */

await waitFor(async () => {
  const ready = await evaluate(`!!document.querySelector('.ProseMirror')`)
  return ready === true
})
await sleep(2500) // 等防抖回调与首屏回填结束

const hashBefore = mdFile ? hashFile(mdFile) : null

const initial = await evaluate(`(() => {
  const pm = document.querySelector('.ProseMirror')
  return {
    taskCheckboxes: pm ? pm.querySelectorAll('.tfn-task__checkbox').length : 0,
    taskItems: pm ? pm.querySelectorAll('li[data-item-type="task"]').length : 0,
    paragraphs: pm ? pm.querySelectorAll('p').length : 0,
    dirty: (document.querySelector('.tfn-toolbar__title')?.textContent ?? '').includes('•'),
    title: document.querySelector('.tfn-toolbar__title')?.textContent ?? '',
  }
})()`)
console.log('初始 DOM:', JSON.stringify(initial))

check('文件内容已加载（任务项 3 个）', initial.taskItems === 3, `taskItems=${initial.taskItems}`)
check('复选框控件数量与任务项一致', initial.taskCheckboxes === 3, `checkboxes=${initial.taskCheckboxes}`)
check('打开文件后不是「已修改」状态', initial.dirty === false, `title="${initial.title.trim()}"`)

const md0 = await readMarkdownViaSource()
check('源码模式能读回文档内容', typeof md0 === 'string' && md0.includes('# 回归测试样张'), String(md0).slice(0, 40))
check('markdown 里任务项状态正确', /- \[ \] 未勾选的任务/.test(md0) && /- \[x\] 已勾选的任务/.test(md0))

/* ---------------- 1. 点击复选框 ---------------- */

const before = await evaluate(`(() => {
  const pm = document.querySelector('.ProseMirror')
  const li = pm.querySelector('li[data-item-type="task"]')
  const cb = li.querySelector('.tfn-task__checkbox')
  return {
    domChecked: cb.getAttribute('aria-checked'),
    glyph: cb.textContent,
    attrChecked: li.getAttribute('data-checked'),
    paragraphs: pm.querySelectorAll('p').length,
  }
})()`)

await evaluate(`(() => {
  const pm = document.querySelector('.ProseMirror')
  const cb = pm.querySelector('li[data-item-type="task"] .tfn-task__checkbox')
  cb.click()
  return true
})()`)
await sleep(900)

const after = await evaluate(`(() => {
  const pm = document.querySelector('.ProseMirror')
  const li = pm.querySelector('li[data-item-type="task"]')
  const cb = li.querySelector('.tfn-task__checkbox')
  return {
    domChecked: cb.getAttribute('aria-checked'),
    glyph: cb.textContent,
    attrChecked: li.getAttribute('data-checked'),
    paragraphs: pm.querySelectorAll('p').length,
    dirty: (document.querySelector('.tfn-toolbar__title')?.textContent ?? '').includes('•'),
  }
})()`)
console.log('点击前:', JSON.stringify(before), '→ 点击后:', JSON.stringify(after))

check(
  '复选框显示状态翻转',
  after.domChecked === 'true' && before.domChecked === 'false',
  `${before.glyph} → ${after.glyph}`,
)
check('list_item 的 data-checked 同步翻转', after.attrChecked === 'true', `data-checked=${after.attrChecked}`)
check('点击后标记为「已修改」', after.dirty === true)

const md1 = await readMarkdownViaSource()
check('markdown 中 [ ] 已变成 [x]', /- \[x\] 未勾选的任务/.test(md1), String(md1).split('\n').find((l) => l.includes('未勾选')) ?? '')
check('其它任务项未被误改', /- \[x\] 已勾选的任务/.test(md1) && /- \[ \] 第三个任务/.test(md1))

/* ---------------- 2. 不自激 ---------------- */

const p1 = await evaluate(`document.querySelectorAll('.ProseMirror p').length`)
await sleep(2500)
const p2 = await evaluate(`document.querySelectorAll('.ProseMirror p').length`)
const md2 = await readMarkdownViaSource()
check('文档结构未持续膨胀（无自激重排）', p1 === p2, `段落数 ${p1} → ${p2}`)
check('markdown 未被反复重写', md1 === md2, md1 === md2 ? '稳定' : '内容发生变化')

/* ---------------- 3. 磁盘文件不被改写 ---------------- */

if (mdFile) {
  const hashAfter = hashFile(mdFile)
  check('磁盘文件未被意外改写', hashBefore === hashAfter, `${hashBefore.slice(0, 12)} → ${hashAfter.slice(0, 12)}`)
} else {
  console.log('SKIP  磁盘文件校验（未提供文件路径）')
}

/* ---------------- 4. 控制台 ---------------- */

check('控制台无错误 / 警告', consoleErrors.length === 0, consoleErrors.join(' | ') || '(无)')

console.log('\n=== 汇总 ===')
const failed = results.filter((r) => !r.ok)
console.log(`通过 ${results.length - failed.length}/${results.length}`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  - ${f.name} ${f.detail ?? ''}`)
}

ws.close()
process.exit(failed.length ? 1 : 0)
