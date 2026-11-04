import type { FileEncoding } from './types'

/**
 * 状态栏里给人看的编码名。
 *
 * 把编码显式摆出来是有价值的：老 md 文件是 GBK，如果显示的是乱码而状态栏
 * 又什么都不说，用户只会觉得「文件坏了」。看到「GBK」就知道是怎么回事。
 */
export function encodingLabel(encoding: FileEncoding | undefined): string {
  switch (encoding) {
    case 'utf8bom':
      return 'UTF-8 (BOM)'
    case 'utf16le':
      return 'UTF-16 LE'
    case 'utf16be':
      return 'UTF-16 BE'
    case 'gbk':
      return 'GBK'
    case 'utf8':
      return 'UTF-8'
    default:
      return 'UTF-8'
  }
}
