/**
 * 合并转发工具（内置）—— NapCat 原生 send_*_forward_msg / get_forward_msg。
 *
 * send_forward_msg：发送合并转发（群/私聊自适应）。
 * get_forward_msg：获取合并转发消息内容（按 resid/message_id）。
 *
 * 节点(messages)格式（OneBot node 段）：每项 {
 *   uin?: "发送者QQ", name?: "发送者昵称",      // 自定义发送者
 *   id?: "已有消息id",                           // 引用已存在消息
 *   content: "文本" | 消息段数组                  // 该节点内容
 * }
 */

import { defineTool, param, groupIdOf, sendApi } from '../toolkit/index.js'

/** send_forward_msg：发送合并转发；群→send_group_forward_msg，私聊→send_private_forward_msg */
export const sendForwardMsgTool = defineTool({
  name: 'send_forward_msg',
  description: '发送合并转发消息（多条消息打包成一条转发卡片）。messages 为节点数组，每项 {uin,name,content} 或 {id}。群聊发群、私聊发好友（按 groupId/userId 自适应）。',
  category: 'message',
  meta: { interactive: true },
  parameters: param.object({
    messages: {
      type: 'array',
      description: '转发节点数组。每项：{ uin:"发送者QQ", name:"昵称", content:"文本或消息段数组" }；或 { id:"已有消息id" }',
      items: { type: 'object' },
    },
    groupId: param.str('目标群号（群聊转发，与 userId 二选一；默认当前群）'),
    userId: param.str('目标 QQ 号（私聊转发，与 groupId 二选一）'),
  }, ['messages']),
  async execute(p, ctx) {
    if (!Array.isArray(p.messages) || !p.messages.length) return { error: 'messages 需为非空节点数组' }
    const gid = groupIdOf(ctx, p.groupId)
    const uid = p.userId ? String(p.userId) : null
    const target = gid ? 'group' : uid ? 'private' : null
    if (!target) return { error: '需指定目标（群聊或 userId）；当前会话无法判断' }
    const action = target === 'group' ? 'send_group_forward_msg' : 'send_private_forward_msg'
    const params = target === 'group'
      ? { group_id: gid, messages: p.messages }
      : { user_id: uid, messages: p.messages }
    const r = await sendApi(ctx, action, params)
    if (!r.ok) return { error: r.error }
    return { ok: true, target, groupId: gid || null, userId: uid || null, messageId: r.data?.message_id ?? null, resId: r.data?.res_id ?? r.data?.resid ?? null }
  },
})

/** get_forward_msg：获取合并转发消息内容 */
export const getForwardMsgTool = defineTool({
  name: 'get_forward_msg',
  description: '按 resid/message_id 获取合并转发消息的完整内容（各节点文本/媒体）。用户发来或转发了合并转发卡片时用它解析内容。',
  category: 'query',
  meta: { resultCap: 10000 },
  parameters: param.object({
    messageId: param.str('合并转发的 resid / message_id'),
  }, ['messageId']),
  async execute(p, ctx) {
    const r = await sendApi(ctx, 'get_forward_msg', { message_id: String(p.messageId) })
    if (!r.ok) return { error: r.error }
    const nodes = Array.isArray(r.data) ? r.data : (r.data?.messages || [])
    const items = nodes.map((n) => ({
      sender: n.sender?.nickname || n.name || null,
      uin: String(n.user_id || n.uin || ''),
      time: n.time ? new Date(n.time * 1000).toLocaleString('zh-CN') : null,
      content: Array.isArray(n.content) ? n.content.map((s) => s?.data?.text || s?.data?.summary || `[${s?.type || ''}]`).join('') : (typeof n.content === 'string' ? n.content : ''),
    }))
    return { ok: true, count: items.length, messages: items }
  },
})

export const forwardTools = [sendForwardMsgTool, getForwardMsgTool]
