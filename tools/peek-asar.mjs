/**
 * 从已安装的 app.asar 里 peek 出一个文件，用于排查打包后主进程入口的实际内容。
 *
 * 用法：node tools/peek-asar.mjs [asarPath] [entryInAsar]
 *   asarPath   默认按 Windows 常见安装位置猜测，也可用第一个参数指定
 *   entryInAsar 默认 out/main/index.js
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const defaultAsar = join(
  homedir(),
  'AppData',
  'Local',
  'Programs',
  'Trifluisnote',
  'resources',
  'app.asar',
)
const p = process.argv[2] ?? defaultAsar
const entry = process.argv[3] ?? 'out/main/index.js'

let buf
for (const candidate of [entry, entry.replace(/\//g, '\\'), '/' + entry]) {
  try {
    buf = asar.extractFile(p, candidate)
    console.log('extracted via:', JSON.stringify(candidate))
    break
  } catch (e) {
    console.log('fail', JSON.stringify(candidate), '-', e.message)
  }
}
if (!buf) process.exit(1)

const out = join(process.cwd(), '.tmp-installed-main.js')
writeFileSync(out, buf)
console.log('bytes:', buf.length, '->', out)
