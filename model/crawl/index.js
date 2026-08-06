/**
 * 网页内容抓取（crawl）—— Node fetch 拿 HTML + cheerio 正文提取（选择器去噪 + 正文区优先）。
 *
 * 用途：
 *  - web_crawl 常驻工具：Agent 对话中抓取任意网页正文（区别于 web_search 的关键词搜索）
 *  - KnowledgeStore.ingestUrl / refreshDoc：知识库 URL 入库 + 定时拉取最新内容
 *
 * 依赖 cheerio（npm，结构化选择器去噪，比正则精准）。纯 HTTP 抓取，无浏览器/子进程；
 * JS 动态渲染页（SPA）拿不到渲染后内容——静态正文够用。
 */

import { load } from 'cheerio'
import Config from '../../utils/Config.js'
import Log from '../../utils/Log.js'

function kbCfg() {
  return Config.get?.()?.agent?.kb || {}
}

/** 真实浏览器 UA + 常用头（减少 403/反爬拒抓） */
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

/** Node fetch HTML → cheerio 正文提取（去 script/style/nav/footer 等 + 优先正文区 + 文本清洗）。 */
export async function crawlWithFetch(url, { timeout = 30 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout * 1000)
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
    const html = await res.text()
    clearTimeout(timer)
    const $ = load(html)
    const title = $('title').first().text().trim() || $('h1').first().text().trim() || ''
    // 去噪：脚本/样式/模板/隐藏/导航/页眉页脚/侧栏/表单/iframe/svg
    $([
      'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
      'nav', 'footer', 'header', 'aside', 'form', 'button',
    ].join(',')).remove()
    $('[style*="display:none"],[style*="display: none"],[hidden],aria-hidden').remove()

    // 优先正文区（article/main/[role=main]/常见内容容器），否则退回 body
    const rootSel = ['article', 'main', '[role="main"]', '#content', '#main', '.content', '.article', '.post-content', '.entry-content'].join(',')
    let root = $(rootSel).first()
    if (!root.length) root = $('body')
    let text = root.text().replace(/\s+/g, ' ').trim()

    // 正文区太短（疑似误选或 SPA 空壳）→ 降级全 body
    if (text.length < 50) {
      text = $('body').text().replace(/\s+/g, ' ').trim()
    }
    if (!text || text.length < 20) return { success: false, error: '页面无有效正文（可能是 JS 动态渲染页）' }
    return { success: true, markdown: text, title, via: 'fetch' }
  } catch (e) {
    clearTimeout(timer)
    return { success: false, error: `fetch 失败：${e?.name === 'AbortError' ? '超时' : (e?.message || e)}` }
  }
}

/** 统一抓取入口（当前为 Node fetch + cheerio 正文提取；保留 crawlUrl 名兼容 KnowledgeStore 调用）。 */
export async function crawlUrl(url, opts = {}) {
  const o = { timeout: kbCfg().crawlTimeout ?? 60, ...opts }
  const r = await crawlWithFetch(url, o)
  if (r.success) Log.info(`[crawl] ${url} via=fetch len=${r.markdown.length}`)
  else Log.warn(`[crawl] ${url} 抓取失败：${r.error}`)
  return r
}

/** web_crawl 常驻工具：抓取网页正文（category=query，人人可用，只读）。 */
export const webCrawlTool = {
  name: 'web_crawl',
  description: '抓取指定网页 URL 的正文内容（基础 HTTP + 正文提取）。读取某个具体网页的全文（区别于 web_search 的关键词搜索）。返回 {title, text}，text 为清洗后正文。注：仅静态抓取，JS 动态渲染页（SPA）可能不完整；若已配置 Crawl4AI 等 MCP 抓取工具，请优先使用 MCP 的 crawl（动态渲染更好）。',
  category: 'query',
  meta: { summary: '抓取网页正文', resultCap: 12000 },
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '目标网页 URL（http:// 或 https://）' },
      maxLength: { type: 'integer', description: '返回正文最大字符数（默认 12000）' },
    },
    required: ['url'],
  },
  async execute({ url, maxLength } = {}) {
    const u = String(url || '').trim()
    if (!/^https?:\/\//i.test(u)) return { error: 'url 需以 http:// 或 https:// 开头' }
    const r = await crawlUrl(u)
    if (!r.success) return { error: r.error || '抓取失败' }
    const cap = Math.max(1000, Number(maxLength) || 12000)
    let text = String(r.markdown || '')
    if (text.length > cap) text = text.slice(0, cap) + `\n…(已截断 ${text.length - cap} 字)`
    return { ok: true, url: u, title: r.title || '', via: 'fetch', length: text.length, text }
  },
}
