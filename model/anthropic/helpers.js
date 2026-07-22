/**
 * Anthropic content blocks 相关纯工具函数。
 */

/**
 * 拼接 message.content 中所有 text block 的文本。
 * @param {array|string} content
 */
export function extractText(content) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
}

/**
 * 拼接 content 中所有 thinking block 的思考文本（不含 redacted_thinking）。
 */
export function extractThinking(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b && b.type === 'thinking' && typeof b.thinking === 'string')
    .map((b) => b.thinking)
    .join('')
}

/** 提取 content 中所有 tool_use block：[{ id, name, input }] */
export function extractToolUses(content) {
  if (!Array.isArray(content)) return []
  return content
    .filter((b) => b && b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }))
}

/**
 * 解析流式累积的工具输入 JSON 片段（input_json_delta.partial_json）。
 * 解析失败返回空对象（避免上层崩溃），原始串可通过第二返回值获取。
 */
export function parseToolInput(rawInput) {
  if (rawInput == null || rawInput === '') return {}
  if (typeof rawInput === 'object') return rawInput
  try {
    return JSON.parse(rawInput)
  } catch {
    return {}
  }
}

/** 取 thinking blocks（含 signature），用于回传时原样保留 */
export function extractThinkingBlocks(content) {
  if (!Array.isArray(content)) return []
  return content.filter(
    (b) => b && (b.type === 'thinking' || b.type === 'redacted_thinking'),
  )
}
