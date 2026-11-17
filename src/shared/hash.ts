/**
 * 轻量内容哈希（FNV-1a 32 位）。
 *
 * 用途：自动保存时，渲染层把内容推给主进程，主进程写盘后回传
 * 「我落盘的是哪一份内容」的哈希；渲染层拿它和自己的当前内容比一下，
 * 就能判断「这份内容是不是已经写进磁盘了」。
 *
 * 为什么不直接回传内容：文档可能上百 KB，回传等于把流量翻倍；
 * 而这里只需要判断「同一份内容」，32 位哈希足够。
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
