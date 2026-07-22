/**
 * Anthropic Messages API 兼容请求库 —— 公共出口。
 *
 * 推荐用法：
 *   import { createClient, presets, block, tool } from '../../model/anthropic/index.js'
 *   const client = createClient({ ...presets.anthropic, apiKey })
 *   const res = await client.messages.create({ model, max_tokens, messages })
 *
 * 详见 README.md。
 */

import { AnthropicClient } from './Client.js'
import { presets, getPreset } from './presets.js'
import {
  APIError,
  TimeoutError,
  ConnectionError,
  isRetryableError,
} from './errors.js'
import {
  extractText,
  extractThinking,
  extractToolUses,
  extractThinkingBlocks,
  parseToolInput,
} from './helpers.js'

/** 工厂：合并预设与配置后构造客户端 */
export function createClient(config = {}) {
  return new AnthropicClient(config)
}

/** 消息构造（Anthropic 角色仅 user/assistant；system 走顶层参数） */
export const msg = {
  user: (content) => ({ role: 'user', content }),
  assistant: (content) => ({ role: 'assistant', content }),
  /** system 作为顶层参数值：字符串或 block 数组 */
  system: (text) => text,
}

/** content block 构造器 */
export const block = {
  text: (text) => ({ type: 'text', text }),

  /** base64 图片 */
  imageBase64: (mediaType, data) => ({
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data },
  }),
  /** URL 图片（部分兼容端点支持） */
  imageUrl: (url) => ({ type: 'image', source: { type: 'url', url } }),

  /** PDF 文档（base64） */
  document: (data) => ({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data },
  }),

  /**
   * 工具结果（放在 user message 的 content 数组里）
   * @param content 字符串或 block 数组（支持富媒体）
   */
  toolResult: (toolUseId, content, isError = false) => ({
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    is_error: isError,
  }),
}

/** 工具定义构造器（Anthropic 用 input_schema，而非 OpenAI 的 function.parameters） */
export const tool = {
  def: ({ name, description, inputSchema, strict }) => {
    const t = { name, description, input_schema: inputSchema }
    if (strict) t.strict = true
    return t
  },
  // tool_choice 策略
  choiceAuto: () => ({ type: 'auto' }),
  choiceAny: () => ({ type: 'any' }),
  choiceNone: () => ({ type: 'none' }),
  choiceTool: (name) => ({ type: 'tool', name }),
}

export {
  AnthropicClient,
  presets,
  getPreset,
  APIError,
  TimeoutError,
  ConnectionError,
  isRetryableError,
  extractText,
  extractThinking,
  extractToolUses,
  extractThinkingBlocks,
  parseToolInput,
}
