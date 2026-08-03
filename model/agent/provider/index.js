/**
 * provider 公共出口 + createProvider 工厂。
 */
import { createClient as createOpenAIClient } from '../../openai/index.js'
import { createClient as createAnthropicClient } from '../../anthropic/index.js'
import { OpenAIProvider } from './openai.js'
import { AnthropicProvider, toAnthropicMessages } from './anthropic.js'
import { GeminiProvider, toGeminiSteps } from './gemini.js'
import { clientOpts } from './base.js'

/**
 * 创建 Provider。
 * @param {object} config
 *   protocol: 'openai' | 'anthropic' | 'gemini'
 *   client?: 已构造的底层客户端（优先）；否则用 preset/apiKey/baseURL/fetch 等自动构造
 *   model?: 默认模型
 * 例：createProvider({ protocol:'openai', ...presets.deepseek, apiKey, model:'deepseek-v4-pro' })
 *     createProvider({ protocol:'gemini', apiKey, model:'gemini-3.6-flash' })  // 原生 Gemini（官方 SDK + Interactions API）
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
  if (protocol === 'gemini') {
    // 原生 Gemini：用官方 @google/genai SDK（Interactions API），不经 createClient（SDK 自带传输层）
    return new GeminiProvider({ ...config })
  }
  throw new Error(`未知 protocol：${protocol}（应为 'openai' | 'anthropic' | 'gemini'）`)
}

export { Provider, toolsToList, mapToolChoice, clientOpts } from './base.js'
export { OpenAIProvider } from './openai.js'
export { AnthropicProvider, toAnthropicMessages } from './anthropic.js'
export { GeminiProvider, toGeminiSteps } from './gemini.js'
