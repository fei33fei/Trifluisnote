// 首启内容回归：安装后第一次启动给一次示例文档，之后一律空白页
//
// Usage: node tools/test-first-run.mjs
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const port = '9447'
const base = `http://127.0.0.1:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 用一个干净的 userData 目录 = 「刚装好的这台机器」
const userData = mkdtempSync(join(tmpdir(), 'tfn-firstrun-'))
// 开发态用的是独立的标记文件
const marker = join(userData, 'first-run.dev.done')

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

function launch() {
  return spawn(
    electron,
    ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`],
    { cwd: root, stdio: 'ignore' },
  )
}

function killTree(proc) {
  return new Promise((resolve) => {
    spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }).on(
      'close',
      () => resolve(),
    )
  })
}

async function readEditorText() {
  const target = await waitFor(async () => {
    const res = await fetch(`${base}/json/list`)
    const list = await res.json()
    return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) ?? null
  })
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
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
  await waitFor(async () => {
    const res = await send('Runtime.evaluate', {
      expression: `!!document.querySelector('.ProseMirror')`,
      returnByValue: true,
    })
    return res.result?.result?.value === true
  })
  await sleep(1500)
  const res = await send('Runtime.evaluate', {
    expression: `(document.querySelector('.ProseMirror')?.innerText ?? '').trim()`,
    returnByValue: true,
  })
  ws.close()
  return res.result?.result?.value ?? ''
}

/* ---------- 干净 userData = 「刚装好」 ---------- */

check('首次启动标记一开始不存在', !existsSync(marker), marker)

/* ---------- 第一次启动：应该有启动内容 ---------- */

let proc = launch()
const first = await readEditorText()
check('第一次启动显示启动内容', first.includes('欢迎使用'), first.slice(0, 40).replace(/\n/g, '⏎'))
check('首次启动后标记已落盘', existsSync(marker))

await killTree(proc)
await sleep(2000)

/* ---------- 第二次启动：应该是空白页 ---------- */

proc = launch()
const second = await readEditorText()
check('第二次启动是空白页', second === '', `内容="${second.slice(0, 40)}"`)

await killTree(proc)

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
