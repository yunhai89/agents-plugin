/** Perplexity Sonar provider —— OpenAI 兼容的带引用答案引擎 */
const BASE = 'https://api.perplexity.ai'

export function createPerplexityProvider({ apiKey, baseURL = BASE, fetcher, timeout = 60000, model = 'sonar' } = {}) {
  const f = fetcher || globalThis.fetch
  return {
    name: 'perplexity',
    available: () => !!apiKey,
    async search(query, options = {}) {
      const body = {
        model: options.model || model,
        messages: [{ role: 'user', content: query }],
        ...(options.search_recency_filter ? { search_recency_filter: options.search_recency_filter } : {}),
        ...(options.search_domain_filter ? { search_domain_filter: options.search_domain_filter } : {}),
        ...(options.reasoning_effort ? { reasoning_effort: options.reasoning_effort } : {}),
      }
      const res = await f(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      })
      if (!res.ok) throw new Error(`Perplexity HTTP ${res.status}: ${await res.text().catch(() => '')}`)
      const json = await res.json()
      const choice = json.choices?.[0]
      return {
        provider: 'perplexity', query,
        answer: choice?.message?.content || '',
        results: (json.search_results || []).map((r) => ({ title: r.title, url: r.url, content: r.date || '', score: null })),
        citations: json.citations || null,
        raw: json,
      }
    },
  }
}
