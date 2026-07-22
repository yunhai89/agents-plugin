/** Exa provider —— 语义搜索引擎（按意思找内容，不是关键词匹配） */
const BASE = 'https://api.exa.ai'

export function createExaProvider({ apiKey, baseURL = BASE, fetcher, timeout = 30000 } = {}) {
  const f = fetcher || globalThis.fetch
  return {
    name: 'exa',
    available: () => !!apiKey,
    async search(query, options = {}) {
      const body = {
        query,
        type: options.type || 'auto',
        numResults: options.max_results || 10,
        ...(options.category ? { category: options.category } : {}),
        ...(options.include_domains ? { includeDomains: options.include_domains } : {}),
        ...(options.exclude_domains ? { excludeDomains: options.exclude_domains } : {}),
        contents: {
          highlights: options.highlights === false ? undefined : (options.highlights_query ? { query: options.highlights_query, numSentences: 3, highlightsPerUrl: 2 } : true),
          ...(options.text ? { text: { maxCharacters: 3000 } } : {}),
        },
      }
      const res = await f(`${baseURL}/search`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      })
      if (!res.ok) throw new Error(`Exa HTTP ${res.status}: ${await res.text().catch(() => '')}`)
      const json = await res.json()
      return {
        provider: 'exa', query,
        answer: json.answer || null,
        results: (json.results || []).map((r) => ({
          title: r.title,
          url: r.url,
          content: (r.highlights && r.highlights.length ? r.highlights.join('\n') : r.text) || '',
          score: r.score,
        })),
        citations: null, raw: json,
      }
    },
  }
}
