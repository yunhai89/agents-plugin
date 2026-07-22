/**
 * ProviderPool —— 多 provider 聚合的选择/故障转移池（非并发池、无队列）。对应 yunhai lib/llm/pool.js。
 *
 * 成员引用：{ name, provider?, breaker? } 或字符串（经 resolve(name) 取 provider）。
 * 策略：failover（按序首个可用）/ round_robin / random / least_errors。
 * 失败转移条件：err.code==='circuit_open' 或 err.isRetryable===true（兼容 openai/anthropic 的 APIError）；
 * 4xx 业务错误不转移（防重复副作用）。
 * 流式：仅在 yield 首个 chunk 前可故障转移；已开始输出则直传错误（防重复输出）。
 */

import { CircuitBreaker, CircuitOpenError } from './circuit.js'

function isRetriable(err) {
  if (!err) return false
  if (err.code === 'circuit_open') return true
  if (typeof err.isRetryable === 'boolean') return err.isRetryable
  return false
}

export class ProviderPool {
  constructor({ name = 'pool', members = [], strategy = 'failover', resolve, breakers } = {}) {
    this.name = name
    this.strategy = strategy
    this.resolve = resolve || (() => null)
    this.members = members.map((m) => (typeof m === 'string' ? { name: m } : m))
    this._breakers = breakers || {}
    this._rr = 0
  }

  _provider(m) {
    return m.provider || this.resolve(m.name)
  }

  _breaker(m) {
    if (!m.breaker) m.breaker = this._breakers[m.name] || (this._breakers[m.name] = new CircuitBreaker())
    return m.breaker
  }

  _available(skip = []) {
    const skipSet = new Set(skip)
    return this.members.filter((m) => !skipSet.has(m.name) && !this._breaker(m).isOpen)
  }

  _pick(available) {
    if (!available.length) return null
    switch (this.strategy) {
      case 'round_robin': {
        const m = available[this._rr % available.length]
        this._rr++
        return m
      }
      case 'random':
        return available[Math.floor(Math.random() * available.length)]
      case 'least_errors':
        return available.slice().sort((a, b) => this._breaker(a).failures - this._breaker(b).failures)[0]
      case 'failover':
      default:
        return available[0]
    }
  }

  _shouldFailover(err) {
    return isRetriable(err)
  }

  /**
   * 非流式：依次尝试可用成员，可重试失败则转移并计入熔断，4xx 直传。
   * 流式（opts.stream=true）：返回 async iterable（首个 chunk 前可转移）。
   */
  async chat(opts = {}) {
    if (opts.stream) return this._stream(opts)
    const tried = []
    for (;;) {
      const m = this._pick(this._available(tried))
      if (!m) throw new CircuitOpenError(`pool ${this.name} 无可用成员`)
      const br = this._breaker(m)
      if (!br.allow()) {
        tried.push(m.name)
        continue
      }
      try {
        const res = await this._provider(m).chat(opts)
        br.success()
        return res
      } catch (e) {
        if (this._shouldFailover(e)) {
          br.failure()
          tried.push(m.name)
          continue
        }
        throw e
      }
    }
  }

  async *_stream(opts) {
    const tried = []
    for (;;) {
      const m = this._pick(this._available(tried))
      if (!m) throw new CircuitOpenError(`pool ${this.name} 无可用成员`)
      const br = this._breaker(m)
      if (!br.allow()) {
        tried.push(m.name)
        continue
      }
      let iter
      try {
        iter = await this._provider(m).chat({ ...opts, stream: true })
      } catch (e) {
        if (this._shouldFailover(e)) {
          br.failure()
          tried.push(m.name)
          continue
        }
        throw e
      }
      let yielded = false
      try {
        for await (const shard of iter) {
          yielded = true
          yield shard
        }
        br.success()
        return
      } catch (e) {
        if (!yielded && this._shouldFailover(e)) {
          br.failure()
          tried.push(m.name)
          continue
        }
        throw e
      }
    }
  }

  toJSON() {
    return {
      name: this.name,
      strategy: this.strategy,
      members: this.members.map((m) => ({ name: m.name, breaker: this._breaker(m).toJSON() })),
    }
  }
}
