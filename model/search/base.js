/**
 * 搜索统一抽象 —— 所有 provider 实现同一接口，返回同一结果类型。
 *
 * SearchResult: { provider, query, results: [{title,url,content,score?}], answer?, citations?, raw? }
 * SearchProvider: { name, available(), async search(query, opts) → SearchResult, async extract?(urls, opts) }
 */

function truncate(s, n) {
  s = String(s ?? '')
  return s.length > n ? `${s.slice(0, n)}...` : s
}

/** 统一格式化为 Agent 可消费的简洁文本 */
export function formatResults(result, { maxResults = 10, maxContent = 500 } = {}) {
  if (!result) return '(无搜索结果)'
  const parts = []
  if (result.answer) parts.push(`💡 ${result.answer}`)
  if (result.results?.length) {
    const items = result.results.slice(0, maxResults).map((r, i) =>
      `[${i + 1}] ${r.title || '(无标题)'}${r.score != null ? ` (score: ${Number(r.score).toFixed(2)})` : ''}\n    ${r.url}\n    ${truncate(r.content, maxContent)}`,
    )
    parts.push(items.join('\n\n'))
  }
  if (result.citations?.length) parts.push(`📎 引用：${result.citations.slice(0, 5).join(' ')}`)
  return parts.join('\n\n') || '(无搜索结果)'
}

/** 格式化提取结果 */
export function formatExtract(res) {
  const ok = (res.results || []).map((r) => `${r.url}:\n${truncate(r.raw_content || r.content || '', 2000)}`)
  const failed = (res.failed || []).map((f) => `❌ ${f.url || f}`)
  const parts = [...ok]
  if (failed.length) parts.push(`提取失败的 URL：\n${failed.join('\n')}`)
  return parts.join('\n\n---\n\n') || '(无内容)'
}
