/**
 * DuckDuckGo Lite 搜索底层实现（零 API key）——供 model/search/providers/ddg.js 复用。
 * 注：原 `webSearchTool`（name=web_search）已移除，避免与 model/search/tools.js 的多源版 web_search 重名
 * （误注册会静默覆盖多源版）。多源版已含 DDG 兜底，本文件只保留 ddgSearch/parseDDG/stripHtml/decodeDDG。
 * fetcher 可注入便于离线测试；无则用 globalThis.fetch。
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
