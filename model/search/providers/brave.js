/** Brave Search provider —— 独立索引的轻量搜索底座 */
const BASE = 'https://api.search.brave.com/res/v1'

export function createBraveProvider({ apiKey, baseURL = BASE, fetcher, timeout = 15000 } = {}) {
  const f = fetcher || globalThis.fetch
  return {
    name: 'brave',
    available: () => !!apiKey,
    async search(query, options = {}) {
      const params = new URLSearchParams({ q: query, count: String(options.max_results || 10) })
      if (options.country) params.set('country', options.country)
      if (options.search_lang) params.set('search_lang', options.search_lang)
      if (options.freshness) params.set('freshness', options.freshness)
      const res = await f(`${baseURL}/web/search?${params}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
        signal: AbortSignal.timeout(timeout),
      })
      if (!res.ok) throw new Error(`Brave HTTP ${res.status}: ${await res.text().catch(() => '')}`)
      const json = await res.json()
      const results = (json.web?.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.description || (r.extra_snippets?.join(' ') || ''),
        score: null,
      }))
      return { provider: 'brave', query, answer: null, results, citations: null, raw: json }
    },
  }
}
