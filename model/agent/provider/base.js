/**
 * Provider 抽象基类与共享工具。
 *
 * 统一结果 AssistantResult：
 *   { role:'assistant', content:string, toolCalls:[{id,name,arguments(对象)}],
 *     reasoning:string|null, finishReason:string|null, usage:object|null, rawMessage }
 *
 * 统一 tool_choice（中性形式）：{ mode:'auto'|'any'|'none'|'tool', name? } 或字符串；各协议自行映射。
 */

/** 从 ToolRegistry 或数组中取出工具列表 */
export function toolsToList(tools) {
  if (!tools) return []
  if (typeof tools.list === 'function') return tools.list()
  return Array.isArray(tools) ? tools : []
}

/** 构造底层客户端时的配置（剥离 provider 专属字段，透传 baseURL/apiKey/preset/fetch 等） */
export function clientOpts(config) {
  const { protocol, client, model, defaultModel, systemRole, reasoningFields, ...rest } = config
  return rest
}

/** 把中性 tool_choice 映射为协议原生形式 */
export function mapToolChoice(tc, proto) {
  if (!tc) return null
  let mode
  let name
  if (typeof tc === 'string') {
    mode = tc
  } else if (tc && tc.mode) {
    mode = tc.mode
    name = tc.name
  } else {
    return tc // 原生对象，原样透传
  }
  if (proto === 'openai') {
    if (mode === 'auto') return 'auto'
    if (mode === 'any' || mode === 'required') return 'required'
    if (mode === 'none') return 'none'
    if (mode === 'tool' && name) return { type: 'function', function: { name } }
    return 'auto'
  }
  // anthropic
  if (mode === 'auto') return { type: 'auto' }
  if (mode === 'any' || mode === 'required') return { type: 'any' }
  if (mode === 'none') return { type: 'none' }
  if (mode === 'tool' && name) return { type: 'tool', name }
  return { type: 'auto' }
}

export class Provider {
  constructor(config = {}) {
    this.client = config.client || null
    this.defaultModel = config.model || config.defaultModel || null
  }

  /** @returns {Promise<AssistantResult>} */
  async chat(/* opts */) {
    throw new Error('Provider.chat 未实现：请使用 OpenAIProvider / AnthropicProvider')
  }
}
