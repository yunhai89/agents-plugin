/**
 * 熔断器 —— 跨请求的失败记忆，自动 trip 与恢复。对应 yunhai lib/llm/circuit.js。
 *
 * 状态机：closed → open（连续失败达 threshold）→ half_open（cooldown 到期，放 halfOpenMax 个试探）→ closed（成功）| open（再失败）。
 * 只对"可重试失败"计数：调用方负责只在 isRetriableError 时调 failure()，4xx 业务错误不计。
 * now 可注入便于确定性测试。
 */

export class CircuitOpenError extends Error {
  constructor(message = 'circuit open', { retryAfter = null } = {}) {
    super(message)
    this.name = 'CircuitOpenError'
    this.code = 'circuit_open'
    this.retryAfter = retryAfter
  }
}

export class CircuitBreaker {
  constructor({ threshold = 5, cooldown = 30000, halfOpenMax = 1, now = Date.now } = {}) {
    this.threshold = threshold
    this.cooldown = cooldown
    this.halfOpenMax = halfOpenMax
    this._now = now
    this.state = 'closed'
    this.failures = 0
    this.openedAt = null
    this._halfOpenInflight = 0
  }

  get isOpen() {
    return this.state === 'open'
  }

  get retryAfter() {
    if (this.state !== 'open' || this.openedAt == null) return 0
    return Math.max(0, this.cooldown - (this._now() - this.openedAt))
  }

  /** 是否放行本次请求 */
  allow() {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (this._now() - this.openedAt >= this.cooldown) {
        this.state = 'half_open'
        this._halfOpenInflight = 0
        return this._halfOpenInflight++ < this.halfOpenMax ? true : false
      }
      return false
    }
    // half_open
    if (this._halfOpenInflight < this.halfOpenMax) {
      this._halfOpenInflight++
      return true
    }
    return false
  }

  success() {
    if (this.state === 'half_open') {
      this.state = 'closed'
    }
    if (this.state === 'closed') {
      this.failures = 0
      this._halfOpenInflight = 0
    }
  }

  /** 记一次失败（仅对可重试错误调用） */
  failure() {
    if (this.state === 'half_open') {
      this._trip()
      return
    }
    this.failures++
    if (this.failures >= this.threshold) this._trip()
  }

  _trip() {
    this.state = 'open'
    this.openedAt = this._now()
    this._halfOpenInflight = 0
  }

  trip() {
    this._trip()
  }

  reset() {
    this.state = 'closed'
    this.failures = 0
    this.openedAt = null
    this._halfOpenInflight = 0
  }

  toJSON() {
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt,
      retryAfter: this.retryAfter,
    }
  }
}
