/**
 * 审批门 confirm —— OpenClaw 式 human-in-the-loop。对应 yunhai lib/agent/confirm.js。
 *
 * policy 返回 'confirm' 时，loop 阻塞在 request() 直到 master 经 #确认/#拒绝 解除，或超时自拒。
 * 内存 pending Map、短 id（便于 QQ 输入）、一次性（每次动作都需新审批）。
 */

export class ConfirmStore {
  constructor({ timeout = 300000, now = Date.now } = {}) {
    this.timeout = timeout
    this._now = now
    this._pending = new Map()
    this._seq = 0
  }

  _nextId() {
    this._seq = (this._seq + 1) % 10000
    return String(this._seq).padStart(4, '0')
  }

  /**
   * 发起一次审批请求；返回 Promise<bool>（true=批准）。
   * @param {function} notify(id, info)  把待审请求投递给 master 的回调（失败不影响，超时兜底）
   */
  request({ tool, args, ctx, notify } = {}) {
    return new Promise((resolve) => {
      const id = this._nextId()
      const timer = setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id)
          resolve(false)
        }
      }, this.timeout)
      this._pending.set(id, { resolve, timer, info: { id, tool, args, ctx, createdAt: this._now() } })
      if (typeof notify === 'function') {
        try { notify(id, { tool, args, ctx }) } catch { /* noop */ }
      }
    })
  }

  /** master 端调用：批准/拒绝某个待审 id */
  resolve(id, approved) {
    const p = this._pending.get(String(id))
    if (!p) return false
    clearTimeout(p.timer)
    this._pending.delete(p.info.id)
    p.resolve(!!approved)
    return true
  }

  list() {
    return [...this._pending.values()].map((p) => ({ id: p.info.id, tool: p.info.tool, args: p.info.args, createdAt: p.info.createdAt }))
  }

  get size() { return this._pending.size }

  clear() {
    for (const p of this._pending.values()) clearTimeout(p.timer)
    this._pending.clear()
  }
}
