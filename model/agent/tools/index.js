/**
 * 工具系统公共出口 + 内置示例工具。
 */
export { ToolRegistry } from './registry.js'
export { ExecutionContext } from './context.js'
export { ddgSearch, parseDDG, stripHtml } from './web.js'
export { noteTools } from './notes.js'
export { clarifyTool, CLARIFY_TOOL_NAME } from './clarify.js'

/**
 * 内置示例工具：get_weather（仅用于测试/演示，返回 mock 数据）。
 */
export const weatherTool = {
  name: 'get_weather',
  description: '获取指定城市的当前天气。输入城市名，返回温度与天气状况。',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名，如 Beijing' },
    },
    required: ['city'],
  },
  async execute(params) {
    return { city: params.city, temperature: 22, condition: 'sunny' }
  },
}

/**
 * 构造一个总是抛错的工具，用于测试"工具异常 → 结果 {error} 不中断循环"。
 */
export function makeFailingTool(name = 'fail', message = 'boom') {
  return {
    name,
    description: '测试用：总是失败',
    parameters: { type: 'object', properties: {} },
    async execute() {
      throw new Error(message)
    },
  }
}
