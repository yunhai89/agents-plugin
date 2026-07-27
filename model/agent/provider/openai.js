/**
 * OpenAIProvider —— 包装 model/openai，统一消息↔OpenAI Chat Completions 格式。
 */
import { createClient, extractReasoning, parseToolArguments } from '../../openai/index.js'
import { Provider, toolsToList, mapToolChoice, clientOpts } from './base.js'
import { stringifyArgs } from '../messages.js'

export class OpenAIProvider extends Provider {
  constructor(config = {}) {
    super(config)
    this.client = config.client || createClient(clientOpts(config))
    this.reasoningFields = config.reasoningFields || this.client.reasoningFields || []
    this.systemRole = config.systemRole || 'system' // 'system' | 'developer'
  }

  async chat(opts) {
    const {
      model, messages, system, tools, tool_choice, temperature, max_tokens, thinking, top_p,
      signal, stream, onDelta, onReasoning, ...rest
    } = opts

    const body = {
      model: model || this.defaultModel,
      messages: this._toMessages(messages, system),
      ...rest,
    }

    const list = toolsToList(tools)
    if (list.length) {
      body.tools = list.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} },
        },
      }))
      const tc = mapToolChoice(tool_choice, 'openai')
      if (tc) body.tool_choice = tc
    }
    if (temperature != null) body.temperature = temperature
    if (top_p != null) body.top_p = top_p
    if (max_tokens != null) body.max_tokens = max_tokens
    if (thinking) body.thinking = thinking
    if (stream) {
      body.stream = true
      body.stream_options = { include_usage: true }
    }

    if (stream) {
      const s = await this.client.chat.completions.create({ ...body, signal })
      for await (const part of s) {
        if (part.delta?.content && onDelta) onDelta(part.delta.content)
        if (part.delta?.reasoning && onReasoning) onReasoning(part.delta.reasoning)
      }
      return this._resultFromStream(s)
    }

    const res = await this.client.chat.completions.create({ ...body, signal })
    return this._resultFromResponse(res)
  }

  _toMessages(messages, system) {
    const out = []
    if (system) out.push({ role: this.systemRole, content: system })
    for (const m of messages) {
      if (m.role === 'system') {
        out.push({ role: this.systemRole, content: m.content })
        continue
      }
      out.push(this._convert(m))
    }
    return out
  }

  _convert(m) {
    const out = { role: m.role, content: m.content }
    if (m.tool_calls) {
      out.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        type: tc.type || 'function',
        function: {
          name: tc.function?.name || tc.name,
          arguments:
            typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : stringifyArgs(tc.function?.arguments ?? tc.arguments),
        },
      }))
    }
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id
    if (m.name) out.name = m.name
    if (m.reasoning) out.reasoning_content = m.reasoning // deepseek 等多轮需回传 reasoning_content
    return out
  }

  _resultFromResponse(res) {
    const choice = res.choices?.[0]
    const message = choice?.message || {}
    const toolCalls = (message.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: parseToolArguments(tc),
    }))
    const reasoning = extractReasoning(message, this.reasoningFields)
    // content 空 + 无 tool_calls + 有 reasoning：用 reasoning 占位 content（防空消息进历史）
    let content = message.content ?? ''
    if (!content && !toolCalls.length && reasoning) {
      content = reasoning  // thinking 模式下正文空但有思考：用思考内容当正文
    }
    return {
      role: 'assistant',
      content,
      toolCalls,
      reasoning,
      finishReason: choice?.finish_reason ?? null,
      usage: res.usage ?? null,
      rawMessage: message,
    }
  }

  _resultFromStream(s) {
    const toolCalls = s.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }))
    return {
      role: 'assistant',
      content: s.content,
      toolCalls,
      reasoning: s.reasoning,
      finishReason: s.finishReason,
      usage: s.usage,
      rawMessage: s.assistantMessage,
    }
  }
}
