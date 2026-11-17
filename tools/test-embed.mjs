// 图片路径 / 内嵌 / 迁移的纯逻辑单测
//
// Usage: node tools/test-embed.mjs
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  embedLocalImages,
  isLocalUrl,
  localPathOf,
  migrateImages,
} from '../src/main/embed.ts'

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`)
}

const root = await mkdtemp(join(tmpdir(), 'tfn-embed-'))
const imgDir = join(root, 'imgs')
await mkdir(imgDir, { recursive: true })
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const imgPath = join(imgDir, 'shot.png')
await writeFile(imgPath, pngBytes)

/* ---------- 路径识别 ---------- */

check(
  'file:// URL 还原成磁盘路径',
  localPathOf('file:///C:/notes/assets/a.png') === 'C:/notes/assets/a.png',
  localPathOf('file:///C:/notes/assets/a.png'),
)
check('Windows 绝对路径原样返回', localPathOf('C:\\notes\\a.png') === 'C:\\notes\\a.png')
check('相对路径不算绝对路径', localPathOf('assets/a.png') === null)
check('http 链接不算本地文件', isLocalUrl('https://example.com/a.png') === false)
check('data URI 不算本地文件', isLocalUrl('data:image/png;base64,AAA') === false)
check('相对路径算本地文件', isLocalUrl('assets/a.png') === true)

/* ---------- 导出内嵌 ---------- */

const html = `<p><img src="shot.png" alt="图"></p><img src="https://example.com/x.png">`
const embedded = await embedLocalImages(html, imgDir)
check('本地图片被换成 data URI', embedded.includes('src="data:image/png;base64,'), embedded.slice(0, 80))
check(
  'base64 内容与原文件一致',
  embedded.includes(pngBytes.toString('base64')),
)
check('远程图片保持原样', embedded.includes('src="https://example.com/x.png"'))
check(
  '没有本地路径残留',
  !embedded.includes('"shot.png"'),
)

const missing = await embedLocalImages('<img src="assets/shot.png">', imgDir)
check('相对路径按基准目录解析', missing.includes('assets/shot.png'), '目录里没有 assets/shot.png，保持原样')

const absEmbedded = await embedLocalImages(
  `<img src="${imgPath.replace(/\\/g, '/')}">`,
  null,
)
check('绝对路径直接内嵌', absEmbedded.includes('src="data:image/png;base64,'))

const noBase = await embedLocalImages('<img src="assets/shot.png">', null)
check('找不到文件时保持原样', noBase.includes('assets/shot.png'))

/* ---------- 另存为时的图片迁移 ---------- */

const notesDir = join(root, 'notes')
await mkdir(notesDir, { recursive: true })
const docPath = join(notesDir, 'doc.md')
const md = `![截图](${imgPath.replace(/\\/g, '/')})\n\n正文\n`
const migrated = await migrateImages(md, docPath)
check('绝对路径改写成相对路径', migrated.includes('![截图](assets/shot.png)'), migrated.trim())
check(
  '图片被复制到新目录',
  (await readFile(join(notesDir, 'assets', 'shot.png'))).equals(pngBytes),
)
check('正文原样保留', migrated.includes('正文'))

const unchanged = await migrateImages('![x](https://example.com/a.png)', docPath)
check('远程图片不被改写', unchanged.includes('https://example.com/a.png'))

const failed = results.filter((r) => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
