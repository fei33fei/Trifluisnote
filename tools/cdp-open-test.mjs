/**
 * 端到端回归：验证「用文件路径启动应用能真正打开本地 md 文件」，
 * 并且老文件（GBK）不会变乱码、保存后编码不被改掉。
 *
 * 用法：
 *   node tools/cdp-open-test.mjs [exePath] [appDir]
 *
 * 默认用仓库里的 electron + 当前目录跑 out/ 构建：
 *   exePath = <项目>/node_modules/electron/dist/electron.exe
 *   appDir  = <项目>
 *
 * 覆盖：
 *   1. UTF-8 文件 → 正文正确
 *   2. UTF-8 BOM 文件 → 正文正确（且开头没有多出一个 BOM 字符）
 *   3. GBK 文件（中文老文件）→ 正文正确，不是乱码；状态栏显示 GBK
 *   4. 保存 GBK 文件 → 磁盘上仍是 GBK，没有被悄悄改成 UTF-8
 *   5. 窗口标题带上文件名
 */

import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import iconv from 'iconv-lite'

const PORT = 9345
const APP_DIR = resolve(process.argv[3] ?? process.cwd())
const EXE = resolve(process.argv[2] ?? join(APP_DIR, 'node_modules/electron/dist/electron.exe'))

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '[✓]' : '[✗]'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ---------- 夹具 ---------- */

const dir = mkdtempSync(join(tmpdir(), 'tfn-enc-'))

const BODY_CN = '# 老文档标题\n\n这是一段中文正文，用来验证 GBK 解码是否正确。\n\n- 项目一\n- 项目二\n'
const BODY_EN = '# Plain\n\nascii only body\n'

const fixtureUtf8 = join(dir, 'utf8.md')
writeFileSync(fixtureUtf8, BODY_EN, 'utf8')

const fixtureBom = join(dir, 'bom.md')
writeFileSync(fixtureBom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(BODY_CN, 'utf8')]))

const fixtureGbk = join(dir, 'gbk.md')
writeFileSync(fixtureGbk, iconv.encode(BODY_CN, 'gbk'))

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

function killAll() {
  const names = ['Trifluisnote.exe', 'electron.exe']
  for (const name of names) {
    try {
      execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore' })
    } catch {
      /* 没有就无所谓 */
    }
  }
}
async function launchWith(filePath) {
  killAll()
  await sleep(1200)
  // electron.exe 需要把应用目录作为第一个参数；已打包的 exe 不需要
  const args = EXE.toLowerCase().endsWith('electron.exe')
    ? [APP_DIR, `--remote-debugging-port=${PORT}`, filePath]
    : [`--remote-debugging-port=${PORT}`, filePath]
  const child = spawn(EXE, args, {
    cwd: APP_DIR,
    stdio: 'ignore',
    detached: false,
  })
  return child
}

async function probe(filePath) {
  const child = await launchWith(filePath)
  let out
  try {
    const { ws, evaluate } = await connect()
    await sleep(1200) // 等首屏把内容灌进编辑器
    out = await evaluate(`(() => {
      const q = (s) => document.querySelector(s)
      const doc = q('.tfn-doc')
      return JSON.stringify({
        text: doc ? doc.innerText : null,
        title: q('.tfn-toolbar__title')?.textContent ?? null,
        status: [...document.querySelectorAll('.tfn-statusbar span')].map((s) => s.textContent),
        winTitle: document.title,
      })
    })()`)
    ws.close()
  } finally {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    await sleep(600)
  }
  return JSON.parse(out)
}

/* ---------- 用例 ---------- */

console.log(`应用：${EXE}`)
console.log(`目录：${APP_DIR}\n`)

// 1. UTF-8
{
  const info = await probe(fixtureUtf8)
  check(
    'UTF-8 文件：正文正确',
    (info.text ?? '').includes('ascii only body'),
    `正文="${(info.text ?? '').slice(0, 50).replace(/\n/g, '⏎')}"`,
  )
  check(
    'UTF-8 文件：窗口标题带上文件名',
    (info.title ?? '').includes('utf8.md') && (info.winTitle ?? '').includes('utf8.md'),
    `工具栏="${info.title}"，窗口标题="${info.winTitle}"`,
  )
}

// 2. UTF-8 BOM
{
  const info = await probe(fixtureBom)
  const text = info.text ?? ''
  check(
    'UTF-8 BOM 文件：正文正确且没有残留 BOM 字符',
    text.includes('这是一段中文正文') && !text.includes('\uFEFF'),
    `正文="${text.slice(0, 40).replace(/\n/g, '⏎')}"`,
  )
  check(
    'UTF-8 BOM 文件：状态栏显示 UTF-8 (BOM)',
    (info.status ?? []).some((s) => s.includes('UTF-8 (BOM)')),
    `状态栏=${JSON.stringify(info.status)}`,
  )
}

// 3. GBK（国内老 md 文件的常态）
{
  const info = await probe(fixtureGbk)
  const text = info.text ?? ''
  const mojibake = /[�]|锟斤拷|æ|ä¸|ç/.test(text)
  check(
    'GBK 文件：中文正文正确（不是乱码）',
    text.includes('这是一段中文正文') && !mojibake,
    `正文="${text.slice(0, 60).replace(/\n/g, '⏎')}"`,
  )
  check(
    'GBK 文件：状态栏显示 GBK',
    (info.status ?? []).some((s) => s.includes('GBK')),
    `状态栏=${JSON.stringify(info.status)}`,
  )
}

// 4. 保存：GBK 文件保存后仍是 GBK
{
  const child = await launchWith(fixtureGbk)
  try {
    const { ws, evaluate } = await connect()
    await sleep(1200)
    const res = await evaluate(
      `window.tfn.saveFile(${JSON.stringify(fixtureGbk)}, '保存后内容：中文测试').then((r) => JSON.stringify(r))`,
    )
    const parsed = JSON.parse(res)
    check('GBK 文件：保存成功', parsed.ok === true, JSON.stringify(parsed))

    const bytes = readFileSync(fixtureGbk)
    const decodedGbk = iconv.decode(bytes, 'gbk')
    const isUtf8 = (() => {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return true
      } catch {
        return false
      }
    })()
    check(
      'GBK 文件：保存后磁盘上仍是 GBK（没被改成 UTF-8）',
      decodedGbk.includes('保存后内容：中文测试') && !isUtf8,
      `字节数=${bytes.length}，GBK 解码="${decodedGbk.trim()}"，是合法 UTF-8=${isUtf8}`,
    )
    ws.close()
  } finally {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    await sleep(600)
  }
}

killAll()
try {
  rmSync(dir, { recursive: true, force: true })
} catch {
  /* ignore */
}

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
