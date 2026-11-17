// 崩溃恢复回归：改内容 → 强杀进程 → 重启 → 提示恢复 → 恢复 / 丢弃
//
// Usage: node tools/cdp-v02-crash-test.mjs
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 项目根目录 = 本脚本所在目录的上一级（tools/ 的上面）
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const port = '9446'
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const recoveryDir = join(
  process.env.APPDATA ?? '',
  'trifluisnote',
  'recovery',
)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
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

async function connect() {
  const target = await waitFor(async () => {
    const res = await fetch(`${base}/json/list`)
    const list = await res.json()
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
  })
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const errors = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.text)
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
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (res.result?.exceptionDetails) return { __error: res.result.exceptionDetails.text }
    return res.result?.result?.value
  }
  return { ws, evaluate, errors }
}

function launch() {
  const proc = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
    cwd: root,
    stdio: 'ignore',
    detached: false,
  })
  return proc
}

/** 连同子进程一起干掉（模拟崩溃）。 */
function killTree(proc) {
  return new Promise((resolve) => {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }).on(
      'close',
      () => resolve(),
    )
  })
}

const marker = '崩溃恢复标记-CRASH-OK'

/* ---------- 第一轮：改内容，然后强杀 ---------- */

let proc = launch()
let conn = await connect()
await waitFor(async () => (await conn.evaluate(`!!document.querySelector('.ProseMirror')`)) === true)
await sleep(2500)

// 切到源码模式改内容（未命名文档没有磁盘文件，只能靠快照恢复）
await conn.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.tfn-toolbar button')].find(b => b.textContent.trim() === '源码模式')
  if (btn) btn.click()
  return true
})()`)
await sleep(1000)
await conn.evaluate(`(() => {
  const ta = document.querySelector('.tfn-editor-pane:not(.is-hidden) .tfn-source')
  if (!ta) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, ta.value + '\\n\\n${marker}')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(2500)

const snapDir = recoveryDir
const hasSnapshot = existsSync(snapDir)
check('崩溃前写下了恢复快照目录', hasSnapshot, snapDir)

conn.ws.close()
await killTree(proc)
await sleep(2500)

/* ---------- 第二轮：重启，应该看到恢复提示 ---------- */

proc = launch()
conn = await connect()
await waitFor(async () => (await conn.evaluate(`!!document.querySelector('.ProseMirror')`)) === true)
await sleep(2500)

const banner = await conn.evaluate(`(() => {
  const bar = document.querySelector('.tfn-recovery')
  return {
    hasBanner: !!bar,
    text: bar ? bar.innerText.replace(/\\n/g, ' | ') : '',
    buttons: bar ? [...bar.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
  }
})()`)
console.log('\n=== 恢复提示条 ===')
console.log(JSON.stringify(banner, null, 2))

check('重启后出现恢复提示条', banner.hasBanner === true)
check('提示条里列出可恢复的文档', /未命名/.test(banner.text), banner.text)
check('提供恢复 / 丢弃操作', banner.buttons.includes('恢复') && banner.buttons.includes('丢弃'))

// 点「恢复」
await conn.evaluate(`(() => {
  const bar = document.querySelector('.tfn-recovery')
  const btn = [...bar.querySelectorAll('button')].find(b => b.textContent.trim() === '恢复')
  btn.click()
  return true
})()`)
await sleep(2000)

// 第二轮启动时是所见即所得模式，切到源码模式才好读内容
await conn.evaluate(`(() => {
  const btn = [...document.querySelectorAll('.tfn-toolbar button')].find(b => b.textContent.trim() === '源码模式')
  if (btn) btn.click()
  return true
})()`)
await sleep(1500)

const restored = await conn.evaluate(`(() => {
  const ta = document.querySelector('.tfn-editor-pane:not(.is-hidden) .tfn-source')
  const tabs = [...document.querySelectorAll('.tfn-tab__title')].map(t => t.textContent)
  return { value: ta ? ta.value : '', tabs }
})()`)
check('恢复后多出一个标签页', restored.tabs.length === 2, restored.tabs.join(' / '))
check('恢复出来的内容包含刚才输入的文本', restored.value.includes(marker))

conn.ws.close()
await killTree(proc)

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
