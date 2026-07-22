/**
 * Anthropic 协议厂商预设。
 *
 * 关键差异（相对 OpenAI 库）：
 *  - 认证头默认 `x-api-key`（MiMo 用 `api-key`），通过 authHeader 配置
 *  - 需要 `anthropic-version` 头（默认 2023-06-01）
 *  - 可选 `anthropic-beta` 头
 *  - 端点为 /v1/messages
 *
 * DeepSeek / MiMo 同时提供 OpenAI 与 Anthropic 两套兼容端点；
 * 这里是它们的 Anthropic 协议入口（与 model/openai/presets.js 的 OpenAI 入口互补）。
 */

export const presets = {
  /** Anthropic 官方 */
  anthropic: {
    name: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    version: '2023-06-01',
    authHeader: 'x-api-key',
  },

  /** DeepSeek（Anthropic 兼容端点，模型用 deepseek-v4-pro / deepseek-v4-flash） */
  deepseek: {
    name: 'deepseek',
    baseURL: 'https://api.deepseek.com/anthropic',
    version: '2023-06-01',
    authHeader: 'x-api-key',
  },

  /**
   * 小米 MiMo（Anthropic 兼容端点）
   * 按量付费：https://api.xiaomimimo.com/anthropic
   * Token Plan：https://token-plan-cn.xiaomimimo.com/anthropic（key 以 tp- 开头）
   * 注意：MiMo 的 Anthropic 协议认证头是 `api-key`（非 x-api-key）。
   */
  mimo: {
    name: 'mimo',
    baseURL: 'https://api.xiaomimimo.com/anthropic',
    version: '2023-06-01',
    authHeader: 'api-key',
  },
}

export function getPreset(name) {
  const p = presets[name]
  if (!p) throw new Error(`未知 Anthropic 厂商预设：${name}`)
  return p
}
