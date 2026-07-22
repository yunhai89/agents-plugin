/**
 * Streamable HTTP 传输（MCP 2025-03-25+ 远程传输）。
 *
 * 单端点：每次请求 POST JSON-RPC，`Accept: application/json, text/event-stream`；
 * 响应可能是直接 JSON，或 SSE 流（其中含本请求的结果 + 可能交织的通知/进度，且可长连）。
 * 从响应头 `Mcp-Session-Id` 记录会话 id，并在后续请求带上；close() 尝试 DELETE 结束会话。
 *
 * SSE 响应按 getReader() 增量解析、逐事件投递 —— 即便服务端把流保持打开、在其中推送
 * 通知或服务端发起的请求（sampling/roots），客户端也能即时处理；对服务端请求的响应经 POST 回送。
 *
 * startListen() 可选：GET Accept:text/event-stream 打开常驻推送流（断线自动退避重连），
 * 用于在没有待处理请求时也能接收服务端主动发起的请求。
 */

import { BaseTransport } from './base.js'

function sleep(ms, signal) {
  return new Promise((r) => {
    if (ms <= 0) return r()
    const t = setTimeout(r, ms)
    t.unref?.()
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true })
  })
}

/** 解析 SSE 文本为消息对象数组（按空行分块、合并多 data: 行、忽略 [DONE]/注释） */
export function parseSSE(text) {
  const out = []
  const events = String(text || '').split(/\r?\n\r?\n/)
  for (const ev of events) {
    const dataLines = []
    for (const line of ev.split(/\r?\n/)) {
      const l = line.replace(/\s+$/, '')
      if (!l || l.startsWith(':')) continue
      if (l.startsWith('data:')) dataLines.push(l.slice(5).replace(/^[\t ]/, ''))
    }
    if (!dataLines.length) continue
    const data = dataLines.join('\n')
    if (data === '[DONE]') continue
    try { out.push(JSON.parse(data)) } catch { /* 跳过非 JSON */ }
  }
  return out
}

export class HttpTransport extends BaseTransport {
  constructor({ url, headers = {}, sessionId, fetcher, requestTimeout = 60000, listen = false, listenRetry = 2000 } = {}) {
    super()
    if (!url) throw new Error('HttpTransport 需要 url')
    this.url = url
    this.headers = headers
    this.sessionId = sessionId || null
    this.fetcher = fetcher || globalThis.fetch
    this.requestTimeout = requestTimeout
    this.listen = listen
    this.listenRetry = listenRetry
    this._listening = false
  }

  async start() {
    if (this.listen) this.startListen()
  }

  /** 增量读取 SSE body，逐事件 onMessage；流保持打开期间持续投递 */
  async _readStream(body) {
    if (!body) return
    if (typeof body.getReader !== 'function') {
      const text = await new Response(body).text()
      for (const m of parseSSE(text)) this._onMessage(m)
      return
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let i
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i)
          buffer = buffer.slice(i + 2)
          for (const m of parseSSE(`${block}\n\n`)) this._onMessage(m)
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) for (const m of parseSSE(`${buffer}\n\n`)) this._onMessage(m)
    } catch (e) {
      this._onError(e)
    } finally {
      try { reader.releaseLock?.() } catch { /* noop */ }
    }
  }

  async send(obj) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.headers,
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId

    const res = await this.fetcher(this.url, { method: 'POST', headers, body: JSON.stringify(obj) })

    const sid = res.headers?.get ? res.headers.get('mcp-session-id') : null
    if (sid) this.sessionId = sid

    if (!res.ok) {
      const t = await res.text().catch(() => '')
      this._onError(new Error(`HTTP ${res.status}: ${t}`))
      return
    }

    const ct = (res.headers?.get ? res.headers.get('content-type') : '') || ''
    if (ct.includes('text/event-stream')) {
      if (res.body && typeof res.body.getReader === 'function') {
        // 后台增量读取（流可长连，承载交织通知/服务端请求）
        this._readStream(res.body).catch((e) => this._onError(e))
      } else {
        const text = await res.text().catch(() => '')
        for (const m of parseSSE(text)) this._onMessage(m)
      }
    } else {
      const text = await res.text()
      if (!text) return
      try {
        this._onMessage(JSON.parse(text))
      } catch (e) {
        this._onError(new Error(`HTTP 解析失败: ${text}`))
      }
    }
  }

  /** 打开常驻 GET SSE 推送流（断线退避重连）；用于接收无待处理请求时的服务端主动消息/请求 */
  async startListen() {
    if (this._listening) return
    this._listening = true
    this._listenLoop().catch((e) => this._onError(e))
  }

  async stopListen() {
    this._listening = false
  }

  async _listenLoop() {
    while (this._listening) {
      try {
        const headers = { Accept: 'text/event-stream', ...this.headers }
        if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
        const res = await this.fetcher(this.url, { method: 'GET', headers })
        const sid = res.headers?.get ? res.headers.get('mcp-session-id') : null
        if (sid) this.sessionId = sid
        const ct = (res.headers?.get ? res.headers.get('content-type') : '') || ''
        if (res.ok && ct.includes('text/event-stream')) {
          await this._readStream(res.body) // 长连，流断开后自动重连
        } else {
          // 服务端不支持专用 GET 推送流
          this._listening = false
          this._onLog(`listen 不被服务端支持（status ${res.status}）`)
          return
        }
      } catch (e) {
        this._onError(e)
      }
      if (this._listening) await sleep(this.listenRetry)
    }
  }

  async close() {
    this._listening = false
    if (!this.sessionId) return
    try {
      const headers = { ...this.headers, 'Mcp-Session-Id': this.sessionId }
      await this.fetcher(this.url, { method: 'DELETE', headers })
    } catch { /* best-effort */ }
  }
}
