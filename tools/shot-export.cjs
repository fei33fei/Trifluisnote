/**
 * 打开导出的 HTML 并截图，用于人工核验导出效果。
 * 用法：electron.exe tools/shot-export.cjs <htmlPath> <pngPath>
 */

const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')

const htmlPath = process.argv[2]
const pngPath = process.argv[3]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    show: false,
    webPreferences: { offscreen: false },
  })
  await win.loadFile(htmlPath)
  // 等一帧让字体与布局稳定
  await new Promise((r) => setTimeout(r, 1200))
  win.showInactive()
  await new Promise((r) => setTimeout(r, 600))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(pngPath, image.toPNG())
  console.log('[x] screenshot ->', pngPath, fs.statSync(pngPath).size, 'bytes')
  app.exit(0)
})
