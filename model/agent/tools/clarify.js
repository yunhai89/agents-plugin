/**
 * clarify 元工具 —— Agent 缺少必要信息时向用户提问。结果被 Agent 检测后作为最终回复直接发出（短路退出循环）。
 * 对应 yunhai lib/agent/tools/personal.js 的 clarify。
 */

export const CLARIFY_TOOL_NAME = 'clarify'

export const clarifyTool = {
  name: CLARIFY_TOOL_NAME,
  description: [
    '当某个【只有用户才知道、且任何工具都查不到】的关键信息缺失、导致无法可靠继续时，提出【一个】简短的澄清问题。',
    '它会被直接发给用户并结束本轮（短路，不再调用其他工具）。',
    '何时该用：目标对象/范围/接收方/身份等指代不明（如"那个""帮他""发群里"——指哪个、谁、哪个群），且无法用工具推断。',
    '何时不该用：能用工具查到的（群成员、群文件、聊天记录、网页等）或能合理推断的，不要用它；也不要把一个任务拆成一串反问——一次只问最阻塞的那一个，其余照常推进。',
  ].join(''),
  category: 'query',
  parameters: {
    type: 'object',
    properties: { question: { type: 'string', description: '向用户提出的澄清问题（一次一个，简短）' } },
    required: ['question'],
  },
  async execute(params) {
    return { clarify: String(params.question || '') }
  },
}
