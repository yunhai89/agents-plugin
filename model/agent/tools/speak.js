/**
 * speak 工具 —— 模型在多步任务中向用户发送【中途】消息。
 *
 * 痛点：ReAct 循环里模型要么调工具（结果内部消化）、要么给最终回复（结束循环），
 * 中间无法"说话"，用户只能看到工具调用提示，感觉模型在埋头苦干。
 * 本工具让模型能在关键节点主动播报：思路/进展/中途发现/出错重试，然后继续工作。
 *
 * 与 clarify 区别：clarify 是"反问后短路退出"；speak 是"播报后继续"。
 * 与最终回复区别：speak 用于中途；最终答案直接文本回复，不用本工具。
 */

import { redactSecrets } from '../redact.js'

export const SPEAK_TOOL_NAME = 'speak'

export const speakTool = {
  name: SPEAK_TOOL_NAME,
  description: [
    '向用户发送一条【中途】消息，让用户看到你的进展（如"我先把方程参数化"、"算出来不对，换种方法"、"查到X，继续验证"）。',
    '调用后立即发到聊天，然后你继续调工具或给最终回复。',
    '何时用：多步任务的关键节点（开始思路 / 重要中间结果 / 出错重试），避免埋头苦干让用户干等。',
    '何时不用：①最终答案——直接回复文本即可，不要用本工具；②每一步都说——只挑关键节点，别刷屏。',
  ].join(''),
  category: 'query',
  meta: { summary: '向用户播报进展' },
  parameters: {
    type: 'object',
    properties: { text: { type: 'string', description: '要发给用户的话（简短，一两句）' } },
    required: ['text'],
  },
  async execute(params, ctx) {
    const text = String(params?.text || '').trim()
    if (!text) return { ok: false, error: '内容为空' }
    const out = redactSecrets(text) // 中途消息也脱敏，防密钥泄漏
    try { await ctx?.e?.reply(out) } catch { /* noop */ }
    return { ok: true }
  },
}
