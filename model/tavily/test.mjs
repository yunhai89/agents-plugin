/**
 * 离线自检 —— mock fetch，不联网 / 不需 API Key。
 * 运行：node model/tavily/test.mjs
 */
import { TavilyClient, TavilyError, makeTavilySearchTool, makeTavilyExtractTool, makeTavilyTools, formatSearchResults, formatExtractResults } from './index.js'

let passed = 0
let failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
function eq(a, b, m) { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, `${m}${s ? '' : `  (got ${JSON.stringify(a)})`}`) }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e) } }
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function mockSeq(responses) {
  let i = 0
  const calls = { count: 0, lastBody: null, lastUrl: null }
  const fn = async (url, opts) => {
    calls.count++; calls.lastUrl = url; calls.lastBody = JSON.parse(opts.body)
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    const mkHeaders = (h) => ({ get: (k) => (h ? h[k.toLowerCase()] ?? null : null) })
    if (r.status >= 400) return { ok: false, status: r.status, headers: mkHeaders(r.headers), async json() { return r.body }, async text() { return JSON.stringify(r.body) } }
    return { ok: true, status: r.status, headers: mkHeaders(r.headers), async json() { return r.body }, async text() { return JSON.stringify(r.body) } }
  }
  fn.calls = calls
  return fn
}

const SEARCH_RES = {
  query: 'test', answer: '答案是42',
  results: [
    { title: '结果A', url: 'https://a.com', content: '内容A内容A', score: 0.9 },
    { title: '结果B', url: 'https://b.com', content: '内容B', score: 0.7 },
  ],
  images: ['https://img.com/1.png'],
  response_time: '0.5', request_id: 'req-1',
}

const EXTRACT_RES = {
  results: [{ url: 'https://en.wikipedia.org/wiki/AI', raw_content: 'AI 是...' }],
  failed_results: [{ url: 'https://bad.com' }],
  response_time: 0.1,
}

// ---------- 1. search ----------
await test('search：基本搜索', async () => {
  const f = mockSeq([{ status: 200, body: SEARCH_RES }])
  const c = new TavilyClient({ apiKey: 'tvly-test', fetcher: f, maxRetries: 0 })
  const res = await c.search('test query', { max_results: 2, include_answer: true })
  eq(res.answer, '答案是42', '返回 answer')
  eq(res.results.length, 2, '2 条结果')
  eq(f.calls.count, 1, '调用 1 次')
  eq(f.calls.lastBody.query, 'test query', 'body 含 query')
  eq(f.calls.lastBody.max_results, 2, 'body 含 max_results')
  eq(f.calls.lastUrl, 'https://api.tavily.com/search', 'URL 正确')
  ok(f.calls.lastBody.include_answer === true, 'include_answer 透传')
})

// ---------- 2. extract ----------
await test('extract：内容提取', async () => {
  const f = mockSeq([{ status: 200, body: EXTRACT_RES }])
  const c = new TavilyClient({ apiKey: 'tvly-test', fetcher: f, maxRetries: 0 })
  const res = await c.extract(['https://en.wikipedia.org/wiki/AI', 'https://bad.com'], { format: 'markdown' })
  eq(res.results.length, 1, '成功提取 1 个')
  eq(res.failed_results.length, 1, '失败 1 个')
  eq(f.calls.lastBody.urls, ['https://en.wikipedia.org/wiki/AI', 'https://bad.com'], 'urls 透传')
})

// ---------- 3. crawl + map ----------
await test('crawl + map：基本调用', async () => {
  const f = mockSeq([
    { status: 200, body: { results: [{ url: 'https://docs.tavily.com/page', raw_content: 'page content' }] } },
    { status: 200, body: { results: ['https://docs.tavily.com/a', 'https://docs.tavily.com/b'] } },
  ])
  const c = new TavilyClient({ apiKey: 'tvly-test', fetcher: f, maxRetries: 0 })
  const cr = await c.crawl('https://docs.tavily.com', { max_depth: 2 })
  eq(cr.results.length, 1, 'crawl 1 页')
  const mr = await c.map('https://docs.tavily.com')
  eq(mr.results.length, 2, 'map 2 个 URL')
})

// ---------- 4. error 400 ----------
await test('error：400 不重试', async () => {
  const f = mockSeq([{ status: 400, body: { detail: { error: 'Invalid topic' } } }])
  const c = new TavilyClient({ apiKey: 'tvly-test', fetcher: f, maxRetries: 3, retryDelay: () => 0 })
  let err = null
  try { await c.search('x', { topic: 'bad' }) } catch (e) { err = e }
  ok(err instanceof TavilyError, '抛 TavilyError')
  eq(err.status, 400, 'status 400')
  eq(err.detail, 'Invalid topic', 'detail 透传')
  eq(f.calls.count, 1, '不重试（1 次）')
})

// ---------- 5. error 429 + retry + success ----------
await test('error：429 尊重 retry-after 后重试成功', async () => {
  const f = mockSeq([
    { status: 429, body: { detail: 'rate limited' }, headers: { 'retry-after': '0' } },
    { status: 200, body: SEARCH_RES },
  ])
  const c = new TavilyClient({ apiKey: 'tvly-test', fetcher: f, maxRetries: 3, retryDelay: () => 0 })
  const res = await c.search('test')
  eq(res.answer, '答案是42', '重试后成功')
  eq(f.calls.count, 2, '调用 2 次（1 失败 + 1 成功）')
})

// ---------- 6. error 432 ----------
await test('error：432 额度耗尽不重试', async () => {
  const f = mockSeq([{ status: 432, body: { detail: 'exceeds plan limit' } }])
  const c = new TavilyClient({ apiKey: 'tvly-test', fetcher: f, maxRetries: 3, retryDelay: () => 0 })
  let err = null
  try { await c.search('x') } catch (e) { err = e }
  eq(err.status, 432, 'status 432')
  ok(err.isQuotaExceeded, 'isQuotaExceeded')
  eq(f.calls.count, 1, '不重试')
})

// ---------- 7. formatSearchResults ----------
await test('formatSearchResults：格式化', async () => {
  const text = formatSearchResults(SEARCH_RES)
  ok(text.includes('答案是42'), '含 answer')
  ok(text.includes('结果A'), '含标题')
  ok(text.includes('https://a.com'), '含 URL')
  ok(text.includes('score: 0.90'), '含评分')
  ok(text.includes('img.com'), '含图片')
  const empty = formatSearchResults({ results: [] })
  eq(empty, '(无搜索结果)', '空结果占位')
})

// ---------- 8. formatExtractResults ----------
await test('formatExtractResults：格式化', async () => {
  const text = formatExtractResults(EXTRACT_RES)
  ok(text.includes('wikipedia.org'), '含 URL')
  ok(text.includes('AI 是'), '含内容')
  ok(text.includes('bad.com'), '含失败 URL')
})

// ---------- 9. tools ----------
await test('tools：makeTavilySearchTool / ExtractTool', async () => {
  const f = mockSeq([{ status: 200, body: SEARCH_RES }])
  const c = new TavilyClient({ apiKey: 'tvly-test', fetcher: f, maxRetries: 0 })

  const sTool = makeTavilySearchTool(c)
  eq(sTool.name, 'web_search', 'search tool name')
  eq(sTool.category, 'query', 'category query')
  const sResult = await sTool.execute({ query: 'test', max_results: 3 })
  ok(sResult.includes('答案是42'), '工具返回格式化结果')
  ok(f.calls.lastBody.include_answer === 'basic', '默认 include_answer=basic')
  ok(f.calls.lastBody.search_depth === 'basic', '默认 search_depth=basic')

  const eTool = makeTavilyExtractTool(c)
  eq(eTool.name, 'web_extract', 'extract tool name')
  eq(eTool.parameters.properties.urls.type, 'array', 'urls 是数组')

  const tools = makeTavilyTools(c)
  eq(tools.length, 2, 'makeTavilyTools 返回 2 个工具')
  eq(tools.map(t => t.name).sort(), ['web_extract', 'web_search'], '工具名')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
