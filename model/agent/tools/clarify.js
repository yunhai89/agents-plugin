/**
 * clarify 元工具 —— Agent 缺少必要信息时向用户提问。结果被 Agent 检测后作为最终回复直接发出（短路退出循环）。
 * 对应 yunhai lib/agent/tools/personal.js 的 clarify。
 */

export const CLARIFY_TOOL_NAME = 'clarify'

export const clarifyTool = {
  name: CLARIFY_TOOL_NAME,
  description: '当你缺少必要信息、或用户请求模糊到无法可靠继续时，提出一个简短的澄清问题。该问题会作为最终回复直接发给用户（不会继续工具循环）。',
  category: 'query',
  parameters: {
    type: 'object',
    properties: { question: { type: 'string', description: '向用户提出的澄清问题' } },
    required: ['question'],
  },
  async execute(params) {
    return { clarify: String(params.question || '') }
  },
}
