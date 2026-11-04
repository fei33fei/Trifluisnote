/**
 * 截取运行中的 Trifluisnote 窗口，用于核验中文渲染。
 * 用法：node shot-app.mjs <cdpPort> <pngPath>
 */
const port = process.argv[2] ?? '9666'
const out = process.argv[3] ?? 'D:/Fey/Desktop/rea-typora/analysis/app-shot.png'
const base = `http://127.0.0.1:${port}`

async function waitFor(fn, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fn()
      if (r) return r
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400))
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
await send('Page.enable')

const metrics = await send('Page.getLayoutMetrics')
const { contentSize } = metrics.result
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: contentSize.width, height: Math.min(contentSize.height, 1400), scale: 1 },
})
if (!shot.result?.data) {
  console.log('capture failed', JSON.stringify(shot).slice(0, 300))
  process.exit(1)
}
const fs = await import('node:fs')
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
console.log('[x] screenshot ->', out, fs.statSync(out).size, 'bytes')
ws.close()
process.exit(0)
