/**
 * 渲染层要用的少量路径处理。
 *
 * 渲染层拿不到 node 的 path 模块（contextIsolation + 无 nodeIntegration），
 * 而「文档所在目录」又必须和主进程算出来的一致，
 * 所以这里只实现真正需要的那一两个函数，规则和 node:path 保持一致。
 */

/** 取所在目录（不存在的父目录返回空串）。 */
export function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return ''
  return filePath.slice(0, index)
}

/** 取文件名。 */
export function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? filePath.slice(index + 1) : filePath
}
