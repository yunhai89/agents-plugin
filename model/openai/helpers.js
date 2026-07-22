/**
 * 响应/消息相关的纯工具函数，供 stream、index 及上层复用。
 */

/**
 * 解析 tool_call.function.arguments（JSON 字符串）为对象。
 * 解析失败时返回原始字符串，避免上层因模型偶发输出非完整 JSON 而崩溃。
 * @param {object|string|null} toolCall 标准 tool_call 对象 / arguments 字符串
 */
export function parseToolArguments(toolCall) {
  if (toolCall == null) return null
  const raw =
    typeof toolCall === 'string'
      ? toolCall
      : toolCall.function?.arguments ?? toolCall.arguments
  if (raw == null) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** 取 tool_call 的 arguments 字符串形式（便于原样回传到下一轮 messages） */
export function toolArgumentsString(toolCall) {
  if (!toolCall) return ''
  if (typeof toolCall === 'string') return toolCall
  if (toolCall.function?.arguments != null) return toolCall.function.arguments
  if (typeof toolCall.arguments === 'string') return toolCall.arguments
  try {
    return JSON.stringify(toolCall.arguments ?? {})
  } catch {
    return ''
  }
}

/**
 * 按候选字段名从 message 提取推理/思考内容（厂商归一化）。
 * 例如 DeepSeek/Zhipu/DashScope 用 reasoning_content，Moonshot 用 reasoning_content 或 reasoning。
 */
export function extractReasoning(message, fields = []) {
  if (!message) return null
  for (const f of fields) {
    const v = message?.[f]
    if (v) return v
  }
  return null
}
