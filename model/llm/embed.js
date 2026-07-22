/**
 * 文本嵌入 —— OpenAI 兼容 /embeddings 端点。对应 yunhai lib/llm/embed.js。
 * 复用底层传输客户端的 baseURL/apiKey/fetcher；按 index 排序、形状保持返回。
 * 仅适用于 OpenAI 兼容端点（DeepSeek/Kimi/Qwen/GLM 等均支持）；Anthropic 原生无 embeddings。
 */

function resolveClient(providerOrClient) {
  if (!providerOrClient) throw new Error('embed 需要 provider 或 client')
  return providerOrClient.client || providerOrClient
}

function buildHeaders(client) {
  const h = { 'Content-Type': 'application/json' }
  if (typeof client.authHeadersHook === 'function') Object.assign(h, client.authHeadersHook(client))
  else if (client.authHeader && client.apiKey) h[client.authHeader] = client.apiKey
  else if (client.apiKey) h['Authorization'] = `Bearer ${client.apiKey}`
  return h
}

/**
 * @param {string|string[]} texts
 * @param {object} opts { client|provider, model?, fetcher?, timeoutMs?, dimensions? }
 * @returns {number[]|number[][]}  形状随输入（单串→向量，数组→向量数组）
 */
export async function embed(texts, opts = {}) {
  const client = resolveClient(opts.client || opts.provider)
  const fetcher = opts.fetcher || client.fetcher || globalThis.fetch
  const baseURL = (client.baseURL || '').replace(/\/+$/, '')
  if (!baseURL) throw new Error('embed 需要 client.baseURL')

  const isArray = Array.isArray(texts)
  const input = isArray ? texts : [texts]
  const body = {
    model: opts.model || client.embeddingModel || 'text-embedding-3-small',
    input,
  }
  if (opts.dimensions != null) body.dimensions = opts.dimensions

  const signal = opts.signal || (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : AbortSignal.timeout(30000))
  const res = await fetcher(`${baseURL}/embeddings`, {
    method: 'POST',
    headers: buildHeaders(client),
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`embed HTTP ${res.status}: ${t}`)
  }
  const json = await res.json()
  const rows = (json.data || [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((r) => r.embedding)
  return isArray ? rows : rows[0] || []
}
