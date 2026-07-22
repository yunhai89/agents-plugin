/** SearXNG provider —— 自建元搜索引擎（无需 API Key，部署即用） */
export function createSearXNGProvider({ url = 'http://localhost:8080', fetcher, timeout = 15000 } = {}) {
  const f = fetcher || globalThis.fetch
  const base = url.replace(/\/+$/, '')
  return {
    name: 'searxng',
    available: () => !!url,
    async search(query, options = {}) {
      const params = new URLSearchParams({ q: query, format: 'json', pageno: '1' })
      if (options.language) params.set('language', options.language)
      if (options.time_range) params.set('time_range', options.time_range)
      if (options.categories) params.set('categories', options.categories)
      const res = await f(`${base}/search?${params}`, { signal: AbortSignal.timeout(timeout) })
      if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`)
      const json = await res.json()
      const results = (json.results || []).slice(0, options.max_results || 10).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content || '',
        score: r.score != null ? r.score : null,
      }))
      return { provider: 'searxng', query, answer: null, results, citations: null, raw: json }
    },
  }
}
