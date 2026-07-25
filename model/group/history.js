/**
 * 群聊历史记录检索（被动找回）—— 模型判断需要更多上下文时主动调用。
 *
 * 与 perception 的"主动注入"（首次入群/久离补课/会话稀薄时自动塞一段）互补：
 * 主动注入只在少数触发点发生；当模型在对话中途发现上下文不够（用户引用了不在窗口里的内容、
 * 说"刚才那个/前面说的"等），可调用本工具按需拉取近期群聊原文，补足会话窗口之外的信息。
 *
 * 复用 e.group.getChatHistory(seq, count) + perception.formatHistory，不造新轮子。
 * 通过 ctx 读取运行时（ctx.e = Yunzai 事件，ctx.bot = Bot 句柄）。
 */

import { formatHistory } from '../perception.js'

function pickGroup(ctx) {
  return ctx?.e?.group || ctx?.bot?.pickGroup?.(ctx?.e?.group_id) || null
}

/**
 * get_chat_history：拉取当前群最近的聊天记录（群友发言，时间正序）。
 * 何时不调：私聊不可用；当前窗口已有足够上下文时无需调用（省 token）。
 */
export const chatHistoryTool = {
  name: 'get_chat_history',
  description: '获取当前群最近的聊天记录（群友发言，按时间正序，已剔除你自己这条）。何时用：用户提到"刚才/前面/上面说的"、引用了不在你记忆里的内容，或你感觉缺少上下文无法准确回答时，调用本工具拉取近期群聊补全。私聊不可用。',
  category: 'query',
  meta: { resultCap: 12000 },
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'integer', description: '拉取条数（默认 20，上限 50）' },
    },
  },
  async execute(params, ctx) {
    const e = ctx?.e
    const g = pickGroup(ctx)
    if (!g || typeof g.getChatHistory !== 'function') {
      return { error: '当前会话非群聊或协议端不支持聊天记录查询' }
    }
    const count = Math.min(50, Math.max(1, Number(params.count) || 20))
    try {
      const seq = e?.seq ?? e?.message_id ?? e?.source?.seq ?? undefined
      let msgs = await g.getChatHistory(seq, count)
      // 数据隔离（默认开）：仅返回当前用户自己的群发言，避免读到他人记录（多用户串档根因）
      if (ctx?.isolation) {
        const me = e?.user_id != null ? String(e.user_id) : null
        if (me) msgs = [].concat(msgs).filter((m) => m && String(m.user_id) === me)
      }
      const lines = formatHistory(msgs, e, count)
      if (!lines.length) return { count: 0, note: '未取到聊天记录（协议端未返回或序列号无效' + (ctx?.isolation ? '；当前为隔离模式，仅含你自己的发言' : '') + '）' }
      return { count: lines.length, history: lines.join('\n') }
    } catch (err) {
      return { error: `取聊天记录失败：${err?.message || err}` }
    }
  },
}

export const groupHistoryTools = [chatHistoryTool]
