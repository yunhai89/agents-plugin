/**
 * TavilyClient —— Tavily 搜索 API 客户端（Search / Extract / Crawl / Map）。
 * 参照 Tavily 开发文档（docs.tavily.com），Bearer 认证，base URL https://api.tavily.com。
 * 零依赖（仅内置 fetch）；429 尊重 retry-after 自动重试。
 */

const BASE_URL = 'https://api.tavily.com'

export class TavilyError extends Error {
  constructor({ status, message, detail, response }) {
    super(message || detail || `Tavily API error (HTTP ${status})`)
    this.name = 'TavilyError'
    this.status = status
    this.detail = detail
    this.response = response
  }
  get isRetryable() {
    return this.status === 429 || this.status >= 500
  }
  get isQuotaExceeded() {
    return this.status === 432 || this.status === 433
  }
}

export class TavilyClient {
  constructor({
    apiKey,
    baseURL = BASE_URL,
    fetcher,
    timeout = 30000,
    maxRetries = 3,
    retryDelay,
  } = {}) {
    if (!apiKey) throw new Error('TavilyClient 需要 apiKey（tvly-...）')
    this.apiKey = apiKey
    this.baseURL = baseURL.replace(/\/+$/, '')
    this.fetcher = fetcher || globalThis.fetch
    this.timeout = timeout
    this.maxRetries = maxRetries
    this.retryDelay = retryDelay || ((attempt) => Math.min(10, 0.5 * 2 ** attempt))
  }

  async _post(endpoint, body) {
    const url = `${this.baseURL}/${endpoint}`
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
    let attempt = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await this.fetcher(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      })

      if (res.ok) return await res.json()

      // 解析错误体
      let errBody = null
      try { errBody = await res.json() } catch { try { errBody = { detail: await res.text() } } catch {} }
      const detail = errBody?.detail?.error || errBody?.detail || errBody?.error || `HTTP ${res.status}`
      const err = new TavilyError({ status: res.status, detail, response: errBody })

      // 可重试：429（尊重 retry-after）或 5xx
      if (err.isRetryable && attempt < this.maxRetries) {
        let wait = this.retryDelay(attempt)
        if (res.status === 429) {
          const ra = res.headers?.get ? res.headers.get('retry-after') : null
          if (ra) wait = Math.max(wait, Number(ra) || wait)
        }
        await sleep(wait * 1000)
        attempt++
        continue
      }

      throw err
    }
  }

  /** 实时网络搜索 */
  async search(query, options = {}) {
    if (!query) throw new Error('search 需要 query')
    return this._post('search', { query, ...options })
  }

  /** 从 URL 批量提取正文 */
  async extract(urls, options = {}) {
    if (!urls) throw new Error('extract 需要 urls')
    return this._post('extract', { urls, ...options })
  }

  /** 从起始 URL 智能爬取整站 */
  async crawl(url, options = {}) {
    if (!url) throw new Error('crawl 需要 url')
    return this._post('crawl', { url, ...options })
  }

  /** 生成站点地图（仅 URL 列表） */
  async map(url, options = {}) {
    if (!url) throw new Error('map 需要 url')
    return this._post('map', { url, ...options })
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)))
}
