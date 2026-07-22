/**
 * LLM 门面 —— 把 capabilities/circuit/pool/embed 与既有 model/openai、model/anthropic 串成统一入口。
 * 轻量注册表 + 池管理 + 能力/embed 辅助；不重写传输。
 *
 * 用法：
 *   import { LLM, detectCapabilities } from '../../model/llm/index.js'
 *   LLM.define('primary', openaiProvider)
 *   LLM.define('backup', anthropicProvider)
 *   const pool = LLM.pool('default', { members:['primary','backup'], strategy:'failover' })
 *   await pool.chat({ messages, model })
 *   detectCapabilities({ protocol:'openai', model:'gpt-4o' })
 */

import { detectCapabilities, BASELINE, PROTOCOL_DEFAULT, REGISTRY } from './capabilities.js'
import { CircuitBreaker, CircuitOpenError } from './circuit.js'
import { ProviderPool } from './pool.js'
import { embed } from './embed.js'

const registry = new Map()

function _get(name) {
  const p = registry.get(name)
  if (!p) throw new Error(`未注册的 provider/pool：${name}（先用 LLM.define / LLM.pool 注册）`)
  return p
}

export const LLM = {
  define(name, provider) {
    registry.set(name, provider)
    return provider
  },
  get(name) {
    return registry.get(name)
  },
  has(name) {
    return registry.has(name)
  },
  list() {
    return [...registry.keys()]
  },
  reset() {
    registry.clear()
  },

  /** 创建并注册一个池；members 可为 provider 实例或已注册的名字 */
  pool(name, { members, strategy = 'failover' }) {
    const norm = members.map((m) =>
      typeof m === 'string' ? { name: m } : { name: m.name || `m${Math.random().toString(36).slice(2, 6)}`, provider: m },
    )
    const p = new ProviderPool({
      name,
      members: norm,
      strategy,
      resolve: (n) => registry.get(n),
    })
    registry.set(name, p)
    return p
  },

  /** 便捷：用名为 'default' 的 provider/pool 跑 chat */
  async chat(opts) {
    return _get('default').chat(opts)
  },
  /** 便捷：流式（opts.stream 自动置 true） */
  async stream(opts) {
    return _get('default').chat({ ...opts, stream: true })
  },

  /** 文本嵌入（走名为 name 的 provider 的 client，默认 'default'） */
  embed(texts, opts = {}) {
    const p = registry.get(opts.provider || 'default')
    return embed(texts, { ...opts, client: p?.client || p })
  },

  /** 探测某 provider 的能力位（provider 需暴露 protocol/model，或直接传 detect 入参） */
  capabilities(name) {
    const p = registry.get(name)
    if (!p) return null
    return detectCapabilities({
      protocol: p.protocol || (p instanceof ProviderPool ? null : 'openai'),
      model: p.defaultModel || p.model || '',
      vendorCaps: p.reasoningFields ? undefined : undefined,
    })
  },

  /** 各成员状态（含熔断器） */
  providersStatus() {
    const out = {}
    for (const [name, p] of registry) {
      out[name] = p instanceof ProviderPool ? p.toJSON() : { type: 'provider' }
    }
    return out
  },
}

export {
  detectCapabilities,
  BASELINE,
  PROTOCOL_DEFAULT,
  REGISTRY,
  CircuitBreaker,
  CircuitOpenError,
  ProviderPool,
  embed,
}
