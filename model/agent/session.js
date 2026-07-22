/**
 * 会话存储 —— 多轮对话历史。
 *
 * 两套模型：
 *  1. group:user 会话（原有）：按 group:user 隔离，滑动窗口 + TTL。
 *  2. 用户多对话（conversation，新增）：每用户可有多个并行对话（类似 ChatGPT 对话列表），
 *     各有 id、标题、历史；一个活跃指针。用于 #聊天列表 / #进入聊天 / #new。
 *
 * 系统提示每轮重建（不存储）。
 */

export class SessionStore {
  constructor({ kv, prefix = 'Yz:agent:sess:', window = 20, ttl = 86400 } = {}) {
    if (!kv) throw new Error('SessionStore 需要 kv')
    this.kv = kv
    this.prefix = prefix
    this.window = window
    this.ttl = ttl
    this._cache = new Map()
  }

  // —— group:user 会话（原有）——
  key(groupId, userId) {
    return `${this.prefix}${groupId || 'private'}:${userId}`
  }

  async get(k) {
    if (!this._cache.has(k)) {
      const val = await this.kv.get(k)
      this._cache.set(k, unpack(val))
    }
    return this._cache.get(k).map((m) => ({ ...m }))
  }

  async getMessages(k) {
    return this.get(k)
  }

  async append(k, msgs) {
    if (!msgs || !msgs.length) return this.get(k)
    const cur = await this.get(k)
    const next = [...cur, ...msgs]
    const trimmed = trimKeepFirst(next, this.window)
    this._cache.set(k, trimmed)
    await this.kv.set(k, { messages: trimmed, updatedAt: Date.now() }, this.ttl)
    return trimmed
  }

  async clear(k) {
    this._cache.delete(k)
    await this.kv.del(k)
  }

  async listAll() {
    const keys = await this.kv.scan(this.prefix)
    const out = []
    for (const k of keys) {
      if (k.includes(':conv:')) continue // 跳过 conversation 键
      const val = await this.kv.get(k)
      const msgs = unpack(val)
      const rest = k.slice(this.prefix.length)
      const [group, user] = rest.split(':')
      out.push({ key: k, group, user, count: msgs.length, updatedAt: val?.updatedAt || null, preview: preview(msgs) })
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  // —— 用户多对话（conversation）——
  convKey(userId, convId) {
    return `${this.prefix}conv:${userId}:${convId}`
  }
  activeKey(userId) {
    return `${this.prefix}conv:active:${userId}`
  }
  seqKey(userId) {
    return `${this.prefix}conv:seq:${userId}`
  }

  async _nextConvId(userId) {
    const seq = (await this.kv.get(this.seqKey(userId))) || 0
    const id = String(seq + 1)
    await this.kv.set(this.seqKey(userId), seq + 1)
    return id
  }

  /** 新建对话并设为活跃 */
  async createConversation(userId, title) {
    const id = await this._nextConvId(userId)
    const conv = {
      id,
      title: title || `对话 ${id}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await this.kv.set(this.convKey(userId, id), conv)
    await this.setActiveConversation(userId, id)
    return conv
  }

  /** 列出用户全部对话（id/title/条数/更新时间/预览） */
  async listConversations(userId) {
    const scanPrefix = `${this.prefix}conv:${userId}:`
    const keys = (await this.kv.scan(scanPrefix)).filter((k) => !k.endsWith(':active') && !k.includes(':seq:'))
    const out = []
    for (const k of keys) {
      const c = await this.kv.get(k)
      if (!c) continue
      out.push({
        id: c.id,
        title: c.title || `对话 ${c.id}`,
        count: (c.messages || []).length,
        updatedAt: c.updatedAt || c.createdAt || 0,
        createdAt: c.createdAt || 0,
        preview: preview(c.messages || []),
      })
    }
    return out.sort((a, b) => Number(a.id) - Number(b.id))
  }

  /** 取活跃对话 id；若无则自动创建首个 */
  async getActiveConversation(userId) {
    const v = await this.kv.get(this.activeKey(userId))
    if (v) return v
    const list = await this.listConversations(userId)
    if (list.length) {
      await this.setActiveConversation(userId, list[0].id)
      return list[0].id
    }
    const c = await this.createConversation(userId)
    return c.id
  }

  async setActiveConversation(userId, convId) {
    const exists = await this.kv.get(this.convKey(userId, String(convId)))
    if (!exists) return false
    await this.kv.set(this.activeKey(userId), String(convId))
    return true
  }

  async getConversation(userId, convId) {
    const c = await this.kv.get(this.convKey(userId, String(convId)))
    return (c?.messages || []).map((m) => ({ ...m }))
  }

  async appendConversation(userId, convId, msgs) {
    const k = this.convKey(userId, String(convId))
    const c = (await this.kv.get(k)) || { id: String(convId), title: `对话 ${convId}`, messages: [], createdAt: Date.now() }
    const next = [...(c.messages || []), ...msgs]
    const trimmed = trimKeepFirst(next, this.window)
    c.messages = trimmed
    c.updatedAt = Date.now()
    await this.kv.set(k, c)
    return trimmed
  }

  async deleteConversation(userId, convId) {
    await this.kv.del(this.convKey(userId, String(convId)))
    const active = await this.kv.get(this.activeKey(userId))
    if (active === String(convId)) {
      const list = await this.listConversations(userId)
      if (list.length) await this.setActiveConversation(userId, list[0].id)
      else await this.createConversation(userId)
    }
  }
}

function unpack(val) {
  if (!val) return []
  if (Array.isArray(val)) return val
  if (Array.isArray(val.messages)) return val.messages
  return []
}

/**
 * 滑动窗口裁剪，但始终保留首条消息（用户原始意图），避免长对话丢失最初目标。
 * 保留 next[0] + 最近 (window-1) 条。
 */
function trimKeepFirst(arr, window) {
  if (!Array.isArray(arr) || arr.length <= window) return arr
  return [arr[0], ...arr.slice(arr.length - (window - 1))]
}

function preview(msgs) {
  const last = [...msgs].reverse().find((m) => m.role === 'user' || m.role === 'assistant')
  const c = last?.content
  return typeof c === 'string' ? c.slice(0, 80) : ''
}
