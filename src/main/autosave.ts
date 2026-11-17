/**
 * 自动保存 + 崩溃恢复（主进程侧）。
 *
 * 职责划分：
 *  - 渲染层负责「什么时候有变化」，把候选内容推过来；
 *  - 主进程负责「什么时候落盘」「落盘到哪」「怎么写编码」，
 *    以及在异常退出时留下可恢复的快照。
 *
 * 为什么放在主进程：写盘、编码探测、原子替换这些都是 IO 侧的事，
 * 放在渲染层会跟编辑器的内容通道搅在一起（曾经就因为回灌导致过自激循环）。
 *
 * 两套产物：
 *  1. 磁盘上的文档本体（自动保存，间隔写）；
 *  2. `userData/recovery/<id>.json` 快照（每次变化都写，间隔短）——
 *     用来在「应用崩了 / 被强杀」之后把没落盘的内容捞回来。
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import type { AutosaveEvent, AutosavePush, FileEncoding, RecoveryItem } from '../shared/types'
import { hashString } from '../shared/hash'
import { decodeText, encodeText } from './encoding'

/** 停止输入后多久把内容写回磁盘。 */
const SAVE_DEBOUNCE_MS = 2000
/** 快照写盘的节流间隔（快照写得比正文频繁，但不能每个按键都写）。 */
const SNAPSHOT_DEBOUNCE_MS = 400
/** 快照最长保留时间，超过就当垃圾清掉。 */
const RECOVERY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

interface PendingDoc {
  tabId: string
  winId: number
  filePath: string | null
  title: string
  encoding: FileEncoding
  content: string
  updatedAt: number
  /** 触发真正写盘的定时器 */
  saveTimer: NodeJS.Timeout | null
  /** 触发快照写盘的定时器 */
  snapshotTimer: NodeJS.Timeout | null
  /** 已经写进磁盘的内容哈希，避免重复写同样的内容 */
  writtenHash: string | null
}

/** tabId → 待落盘文档 */
const pending = new Map<string, PendingDoc>()
let autoSaveEnabled = true

/* ------------------------------------------------------------------ */
/* 工具                                                                  */
/* ------------------------------------------------------------------ */

function recoveryDir(): string {
  return join(app.getPath('userData'), 'recovery')
}

/**
 * 快照 id。
 *
 * 已保存的文档用「文件路径」做 key —— 同一份文件不管开了几次窗口、
 * 崩溃几次，快照都只有一份，不会互相覆盖成碎片。
 * 未命名文档没有路径，只能用 tabId 区分。
 */
function snapshotId(filePath: string | null, tabId: string): string {
  const key = filePath ?? `untitled:${tabId}`
  return createHash('sha1').update(key).digest('hex').slice(0, 16)
}

function notify(winId: number, event: AutosaveEvent): void {
  const win = BrowserWindow.fromId(winId)
  if (!win || win.isDestroyed()) return
  win.webContents.send('autosave:event', event)
}

/* ------------------------------------------------------------------ */
/* 写盘                                                                  */
/* ------------------------------------------------------------------ */

/** 把一份内容写回磁盘（按原编码）。 */
async function writeToDisk(doc: PendingDoc): Promise<void> {
  if (!doc.filePath) return
  const hash = hashString(doc.content)
  if (hash === doc.writtenHash) return
  await writeFile(doc.filePath, encodeText(doc.content, doc.encoding))
  doc.writtenHash = hash
}

/** 写一份崩溃恢复快照。 */
async function writeSnapshot(doc: PendingDoc): Promise<void> {
  const dir = recoveryDir()
  await mkdir(dir, { recursive: true })
  const item: RecoveryItem = {
    id: snapshotId(doc.filePath, doc.tabId),
    filePath: doc.filePath,
    title: doc.title,
    encoding: doc.encoding,
    content: doc.content,
    updatedAt: doc.updatedAt,
  }
  await writeFile(join(dir, `${item.id}.json`), JSON.stringify(item), 'utf8')
}

function scheduleSave(doc: PendingDoc): void {
  if (doc.saveTimer) clearTimeout(doc.saveTimer)
  doc.saveTimer = setTimeout(() => {
    doc.saveTimer = null
    void flushDoc(doc)
  }, SAVE_DEBOUNCE_MS)
}

function scheduleSnapshot(doc: PendingDoc): void {
  if (doc.snapshotTimer) clearTimeout(doc.snapshotTimer)
  doc.snapshotTimer = setTimeout(() => {
    doc.snapshotTimer = null
    void writeSnapshot(doc).catch(() => {
      /* 快照写失败不影响正常编辑，静默忽略 */
    })
  }, SNAPSHOT_DEBOUNCE_MS)
}

/** 真正落盘：先写正文文件，再写快照。 */
async function flushDoc(doc: PendingDoc): Promise<void> {
  if (autoSaveEnabled && doc.filePath) {
    try {
      await writeToDisk(doc)
      notify(doc.winId, {
        tabId: doc.tabId,
        state: 'saved',
        hash: hashString(doc.content),
        at: Date.now(),
      })
    } catch (err) {
      notify(doc.winId, {
        tabId: doc.tabId,
        state: 'error',
        error: (err as Error).message,
        at: Date.now(),
      })
    }
  }
  // 快照总是写：自动保存关掉时，它就是唯一的救命稻草
  try {
    await writeSnapshot(doc)
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* 对外接口                                                              */
/* ------------------------------------------------------------------ */

/** 渲染层推来一份候选内容。 */
export function pushAutosave(payload: AutosavePush, winId: number): void {
  const existing = pending.get(payload.tabId)
  const doc: PendingDoc = existing ?? {
    tabId: payload.tabId,
    winId,
    filePath: payload.filePath,
    title: payload.title,
    encoding: payload.encoding,
    content: '',
    updatedAt: 0,
    saveTimer: null,
    snapshotTimer: null,
    writtenHash: null,
  }

  doc.winId = winId
  doc.filePath = payload.filePath
  doc.title = payload.title
  doc.encoding = payload.encoding
  doc.content = payload.content
  doc.updatedAt = Date.now()
  pending.set(payload.tabId, doc)

  scheduleSave(doc)
  scheduleSnapshot(doc)
  notify(winId, { tabId: doc.tabId, state: 'pending', at: doc.updatedAt })
}

/** 立刻把某个标签页的内容落盘（保存 / 关闭标签页 / 窗口失焦时调用）。 */
export async function flushTab(tabId: string): Promise<void> {
  const doc = pending.get(tabId)
  if (!doc) return
  if (doc.saveTimer) {
    clearTimeout(doc.saveTimer)
    doc.saveTimer = null
  }
  if (doc.snapshotTimer) {
    clearTimeout(doc.snapshotTimer)
    doc.snapshotTimer = null
  }
  await flushDoc(doc)
}

/** 退出前把所有待落盘内容一次性写掉。 */
export async function flushAll(): Promise<void> {
  const docs = Array.from(pending.values())
  for (const doc of docs) {
    if (doc.saveTimer) {
      clearTimeout(doc.saveTimer)
      doc.saveTimer = null
    }
    if (doc.snapshotTimer) {
      clearTimeout(doc.snapshotTimer)
      doc.snapshotTimer = null
    }
  }
  await Promise.all(docs.map((doc) => flushDoc(doc)))
}

/** 窗口关掉了，它下面的待落盘文档也用不着了。 */
export function dropWindow(winId: number): void {
  for (const [tabId, doc] of Array.from(pending.entries())) {
    if (doc.winId !== winId) continue
    if (doc.saveTimer) clearTimeout(doc.saveTimer)
    if (doc.snapshotTimer) clearTimeout(doc.snapshotTimer)
    pending.delete(tabId)
  }
}

/** 开关自动保存。 */
export function setAutoSave(enabled: boolean): void {
  autoSaveEnabled = enabled
}

export function isAutoSaveEnabled(): boolean {
  return autoSaveEnabled
}

/* ------------------------------------------------------------------ */
/* 崩溃恢复                                                              */
/* ------------------------------------------------------------------ */

/**
 * 列出可恢复的快照。
 *
 * 会自动剔除两类快照：
 *  - 磁盘上的文件和快照内容一致 → 没有未落盘的改动，静默清掉；
 *  - 快照太老（超过 30 天）→ 当垃圾清掉。
 */
export async function listRecovery(): Promise<RecoveryItem[]> {
  const dir = recoveryDir()
  if (!existsSync(dir)) return []

  const items: RecoveryItem[] = []
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const full = join(dir, name)
    try {
      const raw = JSON.parse(await readFile(full, 'utf8')) as RecoveryItem
      if (!raw || typeof raw.content !== 'string') {
        await rm(full, { force: true })
        continue
      }
      if (Date.now() - raw.updatedAt > RECOVERY_MAX_AGE_MS) {
        await rm(full, { force: true })
        continue
      }
      if (raw.filePath && existsSync(raw.filePath)) {
        const disk = decodeText(await readFile(raw.filePath)).content
        if (disk === raw.content) {
          // 已经落盘了，没必要再问用户
          await rm(full, { force: true })
          continue
        }
      }
      items.push(raw)
    } catch {
      await rm(full, { force: true }).catch(() => undefined)
    }
  }

  return dedupeByContent(items).sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 去掉内容完全相同的重复快照。
 *
 * 未命名文档没有路径可依，快照只能按 tabId 区分 ——
 * 于是「打开应用 → 改一点 → 崩溃 → 重启 → 再改一点 → 再崩溃」
 * 会攒下一堆内容一样的「未命名」条目，提示条直接被刷屏。
 * 内容一样就只留最新的一份。
 */
function dedupeByContent(items: RecoveryItem[]): RecoveryItem[] {
  const latest = new Map<string, RecoveryItem>()
  for (const item of items) {
    const key = hashString(item.content)
    const seen = latest.get(key)
    if (!seen || item.updatedAt > seen.updatedAt) latest.set(key, item)
  }
  return Array.from(latest.values())
}

/** 处置一个快照。restore = 内容已经捞回编辑器，discard = 彻底丢掉。 */
export async function resolveRecovery(id: string, action: 'restore' | 'discard'): Promise<void> {
  const full = join(recoveryDir(), `${id}.json`)
  if (action === 'discard') {
    await rm(full, { force: true }).catch(() => undefined)
    return
  }
  // restore：已保存的文档保留快照（下次变化会覆盖它），
  // 未命名文档删掉 —— 否则它会以旧 tabId 的名义一直留在列表里。
  try {
    const raw = JSON.parse(await readFile(full, 'utf8')) as RecoveryItem
    if (!raw.filePath) await rm(full, { force: true }).catch(() => undefined)
  } catch {
    await rm(full, { force: true }).catch(() => undefined)
  }
}
