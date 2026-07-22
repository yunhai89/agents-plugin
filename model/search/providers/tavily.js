/** Tavily provider —— 包装既有 TavilyClient */
import { TavilyClient } from '../../tavily/client.js'

export function createTavilyProvider({ apiKey, ...opts } = {}) {
  const client = apiKey ? new TavilyClient({ apiKey, ...opts }) : null
  return {
    name: 'tavily',
    available: () => !!client,
    async search(query, options = {}) {
      const res = await client.search(query, { include_answer: 'basic', max_results: 5, ...options })
      return {
        provider: 'tavily', query,
        answer: res.answer || null,
        results: (res.results || []).map((r) => ({ title: r.title, url: r.url, content: r.content, score: r.score })),
        citations: null, raw: res,
      }
    },
    async extract(urls, options = {}) {
      const res = await client.extract(urls, options)
      return { provider: 'tavily', results: res.results || [], failed: res.failed_results || [], raw: res }
    },
  }
}
