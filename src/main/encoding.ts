/**
 * 本地 Markdown 文件的编码处理。
 *
 * 为什么需要这一层：国内用户的「原本就有的 md 文件」绝大多数是 GBK/GB18030
 * ——记事本、Word 另存、老工具导出，默认编码都是它。按 UTF-8 硬解会整篇乱码，
 * 用户看到的就是「文件打不开 / 一堆方块」。
 *
 * 所以规矩是：
 *   读：先认 BOM，再试严格 UTF-8，失败才退 GBK；
 *   写：按读出来时的原编码写回去，绝不悄悄把用户的文件改成 UTF-8。
 */
import iconv from 'iconv-lite'
import type { FileEncoding } from '../shared/types'

export type { FileEncoding }
export interface DecodedText {
  content: string
  encoding: FileEncoding
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const UTF16LE_BOM = Buffer.from([0xff, 0xfe])
const UTF16BE_BOM = Buffer.from([0xfe, 0xff])

/**
 * 严格 UTF-8 解码：遇到非法字节序列直接抛错。
 * 这是判断「这文件根本不是 UTF-8」最可靠的信号 ——
 * 宽松解码会用 U+FFFD 替换掉坏字节，用户看不出文件原本是 GBK。
 */
function decodeUtf8Strict(buf: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(buf)
}

/**
 * GBK 解码后的「可读性」打分。
 *
 * iconv 的 GBK 解码几乎不会失败（未知字节映射成 '?'），所以光看「有没有抛错」
 * 判断不了真假中文。这里用「合法字符占比」做一道兜底：
 * 如果解出来大量是控制字符 / 私用区字符，说明这压根不是文本文件，
 * 宁可用 UTF-8 的宽松解码，也不要给用户一屏乱码。
 */
function looksLikeText(text: string): boolean {
  if (text.length === 0) return true
  let ok = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    const printable =
      (code >= 0x20 && code <= 0x7e) || // ASCII 可见
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d || // 空白
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
      (code >= 0x3000 && code <= 0x303f) || // CJK 标点
      (code >= 0xff00 && code <= 0xffef) || // 全角
      (code >= 0x2000 && code <= 0x206f) || // 常用标点
      (code >= 0x0400 && code <= 0x04ff) // 西里尔
    if (printable) ok++
  }
  return ok / text.length >= 0.7
}

/** 探测并解码一段字节流。 */
export function decodeText(buf: Buffer): DecodedText {
  if (buf.length >= 3 && buf.subarray(0, 3).equals(UTF8_BOM)) {
    return { content: decodeUtf8Strict(buf.subarray(3)), encoding: 'utf8bom' }
  }
  if (buf.length >= 2 && buf.subarray(0, 2).equals(UTF16LE_BOM)) {
    return { content: buf.subarray(2).toString('utf16le'), encoding: 'utf16le' }
  }
  if (buf.length >= 2 && buf.subarray(0, 2).equals(UTF16BE_BOM)) {
    return { content: iconv.decode(buf.subarray(2), 'utf16-be'), encoding: 'utf16be' }
  }

  try {
    return { content: decodeUtf8Strict(buf), encoding: 'utf8' }
  } catch {
    // 不是合法 UTF-8 —— 老 md 文件基本都是 GBK/GB18030
    const gbk = iconv.decode(buf, 'gbk')
    if (looksLikeText(gbk)) return { content: gbk, encoding: 'gbk' }
    return { content: buf.toString('utf8'), encoding: 'utf8' }
  }
}

/** 按指定编码把文本编码回字节流（写回磁盘用）。 */
export function encodeText(content: string, encoding: FileEncoding): Buffer {
  switch (encoding) {
    case 'utf8bom':
      return Buffer.concat([UTF8_BOM, Buffer.from(content, 'utf8')])
    case 'utf16le':
      return Buffer.concat([UTF16LE_BOM, Buffer.from(content, 'utf16le')])
    case 'utf16be':
      return Buffer.concat([UTF16BE_BOM, iconv.encode(content, 'utf16-be')])
    case 'gbk':
      return iconv.encode(content, 'gbk')
    case 'utf8':
    default:
      return Buffer.from(content, 'utf8')
  }
}
