/**
 * 本地文件 → segment.file 段（base64 形态）——发文件工具统一出口。
 *
 * 为何不能直接 segment.file(本地路径)：
 *   OneBotv11 适配器 makeMsg 的 case "file" 会把 file 段【原样】传给 napcat 的群文件/好友文件
 *   上传 API（upload_group_file / upload_private_file），跳过了 image 等段会走的 makeFile base64
 *   转换。于是裸本地路径（如 /tmp/x.pdf，无协议头）被 napcat 当 URL 解析 → "识别URL失败, uri=..."。
 *   （napcat 这些接口的 file 参数虽支持 路径/URL/Base64，但对裸路径的 URL 预判会失败。）
 *
 * 解法：插件发本地文件前自转 base64://（最通用，不依赖 napcat 是否能访问本地路径）。
 *   napcat 文档（upload_group_file / upload_private_file）：file 支持 文件路径 / URL / Base64。
 *
 * 已是 base64:// / http(s):// / file:// 形态则原样发，不重复编码。
 * 本地路径不存在会抛（fs.readFileSync），由调用方 try/catch 归一为 {error}。
 */

import fs from 'node:fs'

export function toFileSegment(filePath, name) {
  const seg = (typeof segment !== 'undefined' && segment) || null
  if (!seg) throw new Error('当前环境不支持发送文件')
  const f = String(filePath ?? '')
  if (/^(base64|https?|file):\/\//.test(f)) return seg.file(f, name) // 协议形态原样发
  const buf = fs.readFileSync(f) // 本地路径 → base64；不存在抛错
  return seg.file(`base64://${buf.toString('base64')}`, name)
}
