// 把 src/main/export.ts 单独打成可被 Electron 加载的 CJS，用于端到端验证导出
// Usage: node build-export-test.mjs
import { build } from 'vite'
import path from 'node:path'
import fs from 'node:fs'

const root = 'D:/Fey/Desktop/rea-typora/trifluisnote'
const outDir = path.join(root, 'tmp-export-test')

fs.rmSync(outDir, { recursive: true, force: true })

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    ssr: path.join(root, 'src/main/export.ts'),
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'export-test.cjs',
      },
      external: ['electron'],
    },
  },
})

console.log('built ->', path.join(outDir, 'export-test.cjs'))
