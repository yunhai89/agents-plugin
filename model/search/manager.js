/**
 * SearchManager —— 多源搜索管理器（回退链）。
 * 优先级：API key providers（Tavily/Exa/Perplexity/Brave）→ SearXNG（自建）→ DDG（本地兜底）。
 * 任一 provider 失败则自动尝试下一个，直到成功或全部失败。
 */
import { createTavilyProvider } from './providers/tavily.js'
import { createExaProvider } from './providers/exa.js'
import { createPerplexityProvider } from './providers/perplexity.js'
import { createBraveProvider } from './providers/brave.js'
import { createSearXNGProvider } from './providers/searxng.js'
import { createDDGProvider } from './providers/ddg.js'

export class SearchManager {
  constructor({ providers = [], logger = () => {} } = {}) {
    this.providers = providers
    this.logger = logger
  }

  get availableProviders() {
    return this.providers.filter((p) => p.available()).map((p) => p.name)
  }

  async search(query, opts = {}) {
    let lastErr = null
    for (const p of this.providers) {
      if (!p.available()) continue
      try {
        const result = await p.search(query, opts)
        this.logger('debug', `[search] ${p.name} → ${result.results?.length || 0} results`)
        return result
      } catch (e) {
        this.logger('warn', `[search] ${p.name} failed: ${e?.message || e}`)
        lastErr = e
      }
    }
    throw lastErr || new Error('no search providers available')
  }

  async extract(urls, opts = {}) {
    let lastErr = null
    for (const p of this.providers) {
      if (!p.available() || !p.extract) continue
      try {
        return await p.extract(urls, opts)
      } catch (e) {
        this.logger('warn', `[extract] ${p.name} failed: ${e?.message || e}`)
        lastErr = e
      }
    }
    throw lastErr || new Error('no extract providers available')
  }
}

/**
 * 从配置构建 SearchManager。
 * config: { tavily:{apiKey}, exa:{apiKey}, perplexity:{apiKey}, brave:{apiKey}, searxng:{url}, ddg:true, fetcher, logger }
 * 回退链：已配置的 API key provider → SearXNG → DDG（始终兜底）
 */
export function createSearchManager(config = {}) {
  const providers = []
  const fetcher = config.fetcher

  if (config.tavily?.apiKey) providers.push(createTavilyProvider({ ...config.tavily, fetcher }))
  if (config.exa?.apiKey) providers.push(createExaProvider({ ...config.exa, fetcher }))
  if (config.perplexity?.apiKey) providers.push(createPerplexityProvider({ ...config.perplexity, fetcher }))
  if (config.brave?.apiKey) providers.push(createBraveProvider({ ...config.brave, fetcher }))

  // SearXNG（自建，无需 key）
  if (config.searxng?.url) providers.push(createSearXNGProvider({ ...config.searxng, fetcher }))

  // DDG 本地兜底（始终最后）
  if (config.ddg !== false) providers.push(createDDGProvider({ fetcher }))

  return new SearchManager({ providers, logger: config.logger || (() => {}) })
}
