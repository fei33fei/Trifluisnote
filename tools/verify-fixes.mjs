/**
 * 验收脚本：用 CDP 连上正在运行的 Trifluisnote，真实点击验证三项修复。
 *
 * 用法：
 *   npx electron . --remote-debugging-port=9222     # 另开一个终端启动
 *   node tools/verify-fixes.mjs
 *
 * 覆盖：
 *  1. 查找按钮：点一下展开，再点一下收起
 *  2. 工具栏：单行，高度对齐原生菜单栏
 *  3. 所见即所得：点左侧留白 / 正文下方空白都能落光标并直接打字
 */

import { setTimeout as sleep } from 'node:timers/promises'

const PORT = process.argv[2] ?? '9222'
const BASE = `http://127.0.0.1:${PORT}`

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`${BASE}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(500)
  }
  throw new Error('找不到 CDP 页面目标（应用没开或端口不对）')
}

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

function send(method, params = {}) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluate 失败',
    )
  }
  return r.result.value
}

async function click(x, y) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  })
  await sleep(200)
}

async function typeText(text) {
  await send('Input.insertText', { text })
  await sleep(250)
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '[✓]' : '[✗]'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ---------- 1. 查找按钮开合 ---------- */

const findBtn = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.tfn-toolbar .tfn-btn')]
    .find((b) => b.textContent.trim() === '查找')
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)

if (!findBtn) {
  check('查找按钮存在', false, '工具栏里没找到「查找」按钮')
} else {
  await click(findBtn.x, findBtn.y)
  const afterFirst = await evaluate(`!!document.querySelector('.tfn-findbar')`)
  await click(findBtn.x, findBtn.y)
  const afterSecond = await evaluate(`!!document.querySelector('.tfn-findbar')`)
  check(
    '查找按钮：点一下展开，再点一下收起',
    afterFirst === true && afterSecond === false,
    `第一次点击=${afterFirst}，第二次点击=${afterSecond}`,
  )
}

/* ---------- 2. 工具栏单行 + 高度 ---------- */

const layout = await evaluate(`(() => {
  const tb = document.querySelector('.tfn-toolbar')
  const r = tb.getBoundingClientRect()
  return {
    height: r.height,
    rows: tb.getClientRects().length,
    scrollWidth: tb.scrollWidth,
    clientWidth: tb.clientWidth,
    wrapped: tb.scrollWidth > tb.clientWidth + 1,
  }
})()`)

check(
  '工具栏只占一行（不换行）',
  layout.rows === 1 && !layout.wrapped,
  `行数=${layout.rows}，内容宽=${layout.scrollWidth}，可视宽=${layout.clientWidth}`,
)
check(
  '工具栏行高 = 26px（与原生菜单栏一致）',
  Math.abs(layout.height - 26) <= 1,
  `实际 ${layout.height}px`,
)

/* ---------- 3. 所见即所得：留白点击能落光标、能打字 ---------- */

async function caretProbe(x, y, label) {
  await click(x, y)
  const sel = await evaluate(`(() => {
    const s = window.getSelection()
    return {
      active: document.activeElement?.getAttribute?.('contenteditable') ?? document.activeElement?.tagName,
      anchorNode: s.anchorNode?.nodeName ?? null,
      offset: s.anchorOffset,
    }
  })()`)
  const editable = sel.active === 'true'
  const before = await evaluate(`document.querySelector('.ProseMirror')?.innerText ?? ''`)
  await typeText('Z')
  const after = await evaluate(`document.querySelector('.ProseMirror')?.innerText ?? ''`)
  const tail = await evaluate(`(() => {
  const pm = document.querySelector('.ProseMirror')
  const kids = pm.children
  const last = kids[kids.length - 1]
  return { tag: last.tagName, html: last.outerHTML.slice(0, 120) }
})()`)
  check(
    `留白点击能落光标并输入（${label}）`,
    // 长度可以不变（尾部空段落的 <br> 被替换成文字，长度抵消），
    // 真正的判据是「字确实进去了」。
    editable && after.includes('Z') && after.length >= before.length,
    `contenteditable=${sel.active}，锚点=${sel.anchorNode}@${sel.offset}，文本 ${before.length}→${after.length}，末尾=${tail.tag} ${tail.html}`,
  )
  // 不做撤销清理：ProseMirror 的 appendTransaction（trailing 段落）
  // 也进撤销栈，按 Ctrl+Z 会把 trailing 段落一起撤掉，污染后续用例。
}

const margin = await evaluate(`(() => {
  const ed = document.querySelector('.tfn-editor')
  const r = ed.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width }
})()`)
await caretProbe(margin.left - 90, margin.top + 30, '正文左侧留白')

const below = await evaluate(`(() => {
  const host = document.querySelector('.tfn-editor-host')
  host.scrollTop = host.scrollHeight
  const pm = document.querySelector('.ProseMirror')
  const kids = pm.children
  const last = kids[kids.length - 1]
  const r = (last ?? pm).getBoundingClientRect()
  const vh = window.innerHeight
  return {
    x: Math.min(r.x + 20, window.innerWidth - 40),
    y: Math.min(r.bottom + 40, vh - 20),
    lastBottom: r.bottom,
    vh,
  }
})()`)
await caretProbe(below.x, below.y, '正文下方空白')

/* ---------- 4. 源码模式打一行 → 切回所见即所得 → 留白仍可输入 ---------- */

await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'n',
  code: 'KeyN',
  windowsVirtualKeyCode: 78,
  modifiers: 2 | 1, // Ctrl + Alt
})
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'n',
  code: 'KeyN',
  windowsVirtualKeyCode: 78,
  modifiers: 2 | 1,
})
await sleep(600)

// 切到源码模式，打一行
const srcBtn = await evaluate(`(() => {
  // 上一次跑完可能停在源码模式，先统一回到所见即所得
  const back = [...document.querySelectorAll('.tfn-toolbar .tfn-btn')]
    .find((b) => b.textContent.trim() === '所见即所得')
  if (back) back.click()

  const btn = [...document.querySelectorAll('.tfn-toolbar .tfn-btn')]
    .find((b) => b.textContent.trim() === '源码模式')
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})()`)
await sleep(300)
await click(srcBtn.x, srcBtn.y)
await typeText('一行测试')
await click(srcBtn.x, srcBtn.y) // 切回所见即所得
await sleep(500)

const roundTrip = await evaluate(`document.querySelector('.ProseMirror')?.innerText ?? ''`)
check(
  '源码模式打的行切回所见即所得仍在',
  roundTrip.includes('一行测试'),
  `正文="${roundTrip.slice(0, 40)}"`,
)

// 这一行的正下方点击 → 应当能接着输入
const oneLine = await evaluate(`(() => {
  const pm = document.querySelector('.ProseMirror')
  const p = pm.querySelector('p') ?? pm.children[0]
  const r = p.getBoundingClientRect()
  return { x: Math.round(r.x + 10), y: Math.round(r.bottom + 20) }
})()`)
await caretProbe(oneLine.x, oneLine.y, '单行正文正下方')

/* ---------- 汇总 ---------- */

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)
ws.close()
process.exit(failed.length ? 1 : 0)
