/**
 * web 工具 —— DuckDuckGo Lite 抓取（零 API key）。对应 yunhai lib/agent/tools/web.js + tavily.js 的 DDG 回退。
 * fetcher 可注入（ctx.fetcher）便于离线测试；无则用 globalThis.fetch。
 */

export function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解码 DDG lite 的 /l/?uddg=<encoded> 跳转 */
export function decodeDDG(u) {
  try {
    const m = String(u).match(/uddg=([^&]+)/)
    if (m) return decodeURIComponent(m[1])
  } catch { /* noop */ }
  return u
}

/** 解析 DDG Lite HTML → [{title,url,snippet}] */
export function parseDDG(html, limit = 5) {
  const out = []
  const links = []
  const snaps = []
  let m
  const reLink = /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const reSnippet = /<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi
  while ((m = reLink.exec(html))) links.push({ href: decodeDDG(m[1]), title: stripHtml(m[2]) })
  while ((m = reSnippet.exec(html))) snaps.push(stripHtml(m[1]))
  const n = Math.min(limit, links.length)
  for (let i = 0; i < n; i++) out.push({ title: links[i].title, url: links[i].href, snippet: snaps[i] || '' })
  return out
}

export async function ddgSearch(query, { limit = 5, fetcher, fetchOpts } = {}) {
  const f = fetcher || globalThis.fetch
  if (!f) throw new Error('ddgSearch 需要 fetcher 或 globalThis.fetch')
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
  const res = await f(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (agents-plugin)' }, ...fetchOpts })
  const html = await res.text()
  return parseDDG(html, limit)
}

export const webSearchTool = {
  name: 'web_search',
  description: '联网搜索（DuckDuckGo，无需 API key）。输入查询词，返回若干条结果（标题/链接/摘要）。何时用：需要超出你知识范围、或需要实时/最新信息时（天气/新闻/价格/版本等）。优先权威一手来源。',
  category: 'query',
  meta: { summary: '联网搜索获取实时信息' },
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: '搜索关键词' } },
    required: ['query'],
  },
  async execute(params, ctx) {
    const results = await ddgSearch(params.query, { fetcher: ctx?.fetcher })
    return results
  },
}
