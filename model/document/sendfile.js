/**
 * send_file 工具 —— 发送任意文件到聊天。
 *
 * 模型调用本工具把本地文件（图片/文档/压缩包等）发送给用户。
 * 底层用 segment.file + e.reply（走群文件/好友文件上传 API）。
 */

import { toFileSegment } from '../../utils/SendFile.js'

export const sendFileTool = {
  name: 'send_file',
  description: '发送本地文件到聊天（图片/文档/压缩包/音频/视频等任意文件）。何时用：用户让你发某个已存在但尚未发送的文件时。注意：create_excel 等工具在创建文件时会自动发送，不要用本工具重复发送同一文件。',
  category: 'query',
  meta: { summary: '发送文件到聊天' },
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '本地文件绝对路径' },
      name: { type: 'string', description: '显示文件名（可选，默认用原文件名）' },
    },
    required: ['path'],
  },
  async execute(params, ctx) {
    const p = String(params?.path || '').trim()
    if (!p) return { error: '请提供文件路径' }
    const name = params?.name?.trim() || undefined
    try {
      await ctx?.e?.reply(toFileSegment(p, name))
      return { ok: true, path: p }
    } catch (e) {
      return { error: `发送失败：${e?.message || e}` }
    }
  },
}
