/**
 * provider 公共出口 + createProvider 工厂。
 */
import { createClient as createOpenAIClient } from '../../openai/index.js'
import { createClient as createAnthropicClient } from '../../anthropic/index.js'
import { OpenAIProvider } from './openai.js'
import { AnthropicProvider, toAnthropicMessages } from './anthropic.js'
import { clientOpts } from './base.js'

/**
 * 创建 Provider。
 * @param {object} config
 *   protocol: 'openai' | 'anthropic'
 *   client?: 已构造的底层客户端（优先）；否则用 preset/apiKey/baseURL/fetch 等自动构造
 *   model?: 默认模型
 * 例：createProvider({ protocol:'openai', ...presets.deepseek, apiKey, model:'deepseek-v4-pro' })
 */
export function createProvider(config = {}) {
  const protocol = config.protocol || 'openai'
  if (protocol === 'openai') {
    const client = config.client || createOpenAIClient(clientOpts(config))
    return new OpenAIProvider({ ...config, client })
  }
  if (protocol === 'anthropic') {
    const client = config.client || createAnthropicClient(clientOpts(config))
    return new AnthropicProvider({ ...config, client })
  }
  throw new Error(`未知 protocol：${protocol}（应为 'openai' 或 'anthropic'）`)
}

export { Provider, toolsToList, mapToolChoice, clientOpts } from './base.js'
export { OpenAIProvider } from './openai.js'
export { AnthropicProvider, toAnthropicMessages } from './anthropic.js'
