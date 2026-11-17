/**
 * 端到端回归：验证「启动内容只在安装后第一次启动出现一次，之后一律空白页」。
 *
 * 用法：
 *   node tools/cdp-startup-test.mjs [exePath] [appDir]
 *
 * 默认用仓库里的 electron + 当前目录跑 out/ 构建：
 *   exePath = <项目>/node_modules/electron/dist/electron.exe
 *   appDir  = <项目>
 *
 * 覆盖：
 *   1. 干净 userData 首次启动 → 正文是启动内容（示例文档）
 *   2. 同一 userData 再次启动 → 正文为空（空白页）
 *   3. 首次启动时带文件 → 正文是文件内容，不是启动内容
 *   4. 首次标记落在测试用的 userData 里（没污染真实 %APPDATA%）
 *
 * 全程用独立的临时 userData（--user-data-dir），不碰用户真实的
 * %APPDATA%\trifluisnote，也不动别的 electron 进程（只 taskkill 自己拉起来的
 * 那个进程树，不按进程名批量杀）。
 */

import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = 9377
const APP_DIR = resolve(process.argv[3] ?? process.cwd())
const EXE = resolve(process.argv[2] ?? join(APP_DIR, 'node_modules/electron/dist/electron.exe'))

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '[✓]' : '[✗]'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ---------- 夹具 ---------- */

const root = mkdtempSync(join(tmpdir(), 'tfn-startup-'))
const profile = join(root, 'profile')
const fixture = join(root, 'hello.md')
writeFileSync(fixture, '# 夹具文档\n\n这是用户自己的文件内容。\n', 'utf8')

/* ---------- CDP 小工具 ---------- */

async function findPage(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(400)
  }
  throw new Error('CDP 页面目标没出现')
}

async function connect() {
  const page = await findPage()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  }
  const send = (method, params = {}) => {
    const id = ++seq
    ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }))
  }
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate 失败')
    }
    return r.result.value
  }
  return { ws, send, evaluate }
}

/* ---------- 启动 / 停止 ---------- */

/** 只杀自己拉起来的那棵进程树，不按进程名批量 taskkill。 */
function killTree(pid) {
  if (!pid) return
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' })
  } catch {
    /* 已经退了 */
  }
}

async function launch(args) {
  const isElectron = EXE.toLowerCase().endsWith('electron.exe')
  const full = [
    ...(isElectron ? [APP_DIR] : []),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    ...args,
  ]
  return spawn(EXE, full, { cwd: APP_DIR, stdio: 'ignore', detached: false })
}

async function probe(args, shotPath) {
  const child = await launch(args)
  try {
    const { ws, send, evaluate } = await connect()
    await sleep(1500) // 等首屏把内容灌进编辑器
    const out = await evaluate(`(() => {
      const q = (s) => document.querySelector(s)
      const doc = q('.tfn-doc') ?? q('.ProseMirror')
      return JSON.stringify({
        text: doc ? doc.innerText : null,
        title: q('.tfn-toolbar__title')?.textContent ?? null,
        status: [...document.querySelectorAll('.tfn-statusbar span')].map((s) => s.textContent),
      })
    })()`)

    if (shotPath) {
      // 本脚本的 send() 已经把 CDP 的 result 解包出来了，
      // 所以是 metrics.contentSize / shot.data，不是 .result.contentSize。
      const metrics = await send('Page.getLayoutMetrics')
      const contentSize = metrics?.contentSize ?? { width: 1100, height: 760 }
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: contentSize.width, height: Math.min(contentSize.height, 1200), scale: 1 },
      })
      if (shot?.data) {
        writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
        console.log(`    （截图 → ${shotPath}）`)
      }
    }

    ws.close()
    return JSON.parse(out)
  } finally {
    killTree(child.pid)
    await sleep(800)
  }
}

/* ---------- 用例 ---------- */

console.log(`应用：${EXE}`)
console.log(`目录：${APP_DIR}`)
console.log(`profile：${profile}\n`)

/** 截图落点：项目里的 .tmp-shots/（已被 .gitignore 忽略，不入库）。 */
const shotDir = join(APP_DIR, '.tmp-shots')
mkdirSync(shotDir, { recursive: true })
const shotFirst = join(shotDir, 'startup-first-run.png')
const shotLater = join(shotDir, 'startup-later.png')

// 1. 干净 profile 的第一次启动 → 启动内容
{
  const info = await probe([], shotFirst)
  const text = (info.text ?? '').trim()
  check(
    '首次启动：正文是启动内容（示例文档）',
    text.includes('Trifluisnote') && text.includes('欢迎使用'),
    `正文首行="${text.split('\n')[0] ?? ''}"`,
  )
}

// 2. 同一 profile 再次启动 → 空白页
{
  const info = await probe([], shotLater)
  const text = (info.text ?? '').trim()
  check('再次启动：正文为空（空白页）', text === '', `正文="${text.slice(0, 60)}"`)
  check('再次启动：状态栏字数归零', (info.status ?? []).some((s) => /^0 字/.test(s.trim())), `状态栏=${JSON.stringify(info.status)}`)
}

// 3. 首次标记落在测试 profile 里（没有污染真实 %APPDATA%）
{
  const entries = existsSync(profile) ? readdirSync(profile) : []
  const marker = entries.find((e) => e.startsWith('first-run'))
  check('首次标记写在测试 profile 内', Boolean(marker), `标记="${marker ?? '无'}"，profile 内容=${JSON.stringify(entries.slice(0, 12))}`)
}

// 4. 带文件启动 → 用文件内容，不是启动内容
{
  const info = await probe([fixture])
  const text = (info.text ?? '').trim()
  check(
    '带文件启动：正文是文件自己的内容',
    text.includes('夹具文档') && !text.includes('欢迎使用'),
    `正文="${text.replace(/\n/g, '⏎').slice(0, 60)}"`,
  )
}

try {
  rmSync(root, { recursive: true, force: true })
} catch {
  /* 临时目录清不掉也无所谓 */
}

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
