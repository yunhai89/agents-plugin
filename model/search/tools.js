/** Agent 工具 —— 包装 SearchManager 为 ToolRegistry 兼容工具 */
import { formatResults, formatExtract } from './base.js'

function pick(obj, keys) {
  const o = {}
  for (const k of keys) if (obj[k] != null) o[k] = obj[k]
  return o
}

export function makeSearchTools(manager, defaults = {}) {
  return [
    {
      name: 'web_search',
      description: '联网搜索（多源自动路由：Tavily/Exa/Perplexity/Brave → SearXNG → 本地 DDG 兜底）。输入查询词，返回排序后的相关结果 + 可选 AI 答案。用于获取实时信息或超出知识范围的内容。',
      category: 'query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询' },
          max_results: { type: 'integer', description: '返回结果数（默认 5-10）' },
          topic: { type: 'string', description: '搜索类别（general/news/finance）' },
          time_range: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: '时间过滤' },
        },
        required: ['query'],
      },
      async execute(params = {}) {
        const opts = { ...defaults, ...pick(params, ['max_results', 'topic', 'time_range', 'search_depth', 'include_domains', 'exclude_domains', 'country']) }
        const result = await manager.search(params.query, opts)
        return formatResults(result)
      },
    },
    {
      name: 'web_extract',
      description: '从指定 URL 提取干净的正文内容。输入 URL 列表，返回清洗后的正文。',
      category: 'query',
      meta: { resultCap: 12000 },
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' }, description: '要提取的 URL 列表' },
        },
        required: ['urls'],
      },
      async execute(params = {}) {
        try {
          const res = await manager.extract(params.urls)
          return formatExtract(res)
        } catch (e) {
          return `(提取失败：${e?.message || e})`
        }
      },
    },
  ]
}
