/**
 * JSON-RPC 2.0 —— 消息构造/判定 + 信道（id 相关、pending、超时、双向路由）。MCP 的传输层信封。
 */

export const JSONRPC = '2.0'

export const ERR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
}

export function makeRequest(id, method, params) {
  const m = { jsonrpc: JSONRPC, id, method }
  if (params !== undefined) m.params = params
  return m
}
export function makeNotification(method, params) {
  const m = { jsonrpc: JSONRPC, method }
  if (params !== undefined) m.params = params
  return m
}
export function makeResponse(id, result) {
  return { jsonrpc: JSONRPC, id, result }
}
export function makeErrorResponse(id, code, message, data) {
  const m = { jsonrpc: JSONRPC, id, error: { code, message } }
  if (data !== undefined) m.error.data = data
  return m
}

export function isResponse(m) {
  return !!m && m.jsonrpc === JSONRPC && ('result' in m || 'error' in m) && m.id != null && m.method == null
}
export function isRequest(m) {
  return !!m && m.jsonrpc === JSONRPC && m.method != null && m.id != null
}
export function isNotification(m) {
  return !!m && m.jsonrpc === JSONRPC && m.method != null && m.id == null
}

export class JsonRpcError extends Error {
  constructor(code, message, data) {
    super(message)
    this.name = 'JsonRpcError'
    this.code = code
    this.data = data
  }
  toJSON() {
    const e = { code: this.code, message: this.message }
    if (this.data !== undefined) e.data = this.data
    return e
  }
}

/**
 * 与传输解耦的 JSON-RPC 信道。
 * @param {function} send  写出一条消息到传输（async）
 * @param {function} onRequest(method, params)→result  处理对端请求（async，可抛 JsonRpcError）
 * @param {function} onNotification(method, params)  处理对端通知
 */
export class JsonRpcChannel {
  constructor({ send, onRequest, onNotification, timeout = 60000 } = {}) {
    if (typeof send !== 'function') throw new Error('JsonRpcChannel 需要 send(obj)')
    this._send = send
    this._onRequest = onRequest || (() => { throw new JsonRpcError(ERR.METHOD_NOT_FOUND, 'method not found') })
    this._onNotification = onNotification || (() => {})
    this.timeout = timeout
    this._id = 0
    this._pending = new Map()
  }

  _nextId() {
    this._id = (this._id + 1) % Number.MAX_SAFE_INTEGER
    return this._id
  }

  /** 发送请求并等结果（按 id 相关；超时/中止 reject） */
  request(method, params, { timeout = this.timeout, signal } = {}) {
    const id = this._nextId()
    const msg = makeRequest(id, method, params)
    return new Promise((resolve, reject) => {
      let timer = null
      const clean = () => {
        if (timer) clearTimeout(timer)
        this._pending.delete(id)
      }
      const onAbort = () => {
        clean()
        reject(new JsonRpcError(-1, `aborted: ${method}`))
      }
      if (timeout && timeout > 0) {
        timer = setTimeout(() => {
          clean()
          reject(new JsonRpcError(-1, `request timeout: ${method}`))
        }, timeout)
        timer.unref?.()
      }
      if (signal) {
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this._pending.set(id, {
        resolve: (v) => { clean(); resolve(v) },
        reject: (e) => { clean(); reject(e) },
      })
      Promise.resolve(this._send(msg)).catch((e) => {
        const p = this._pending.get(id)
        if (p) p.reject(e)
      })
    })
  }

  /** 发送通知（无 id，不等响应） */
  notify(method, params) {
    return this._send(makeNotification(method, params))
  }

  /** 处理来自传输的一条消息 */
  receive(msg) {
    if (!msg || typeof msg !== 'object') return
    if (isResponse(msg)) {
      const p = this._pending.get(msg.id)
      if (!p) return
      if ('error' in msg) p.reject(new JsonRpcError(msg.error.code, msg.error.message, msg.error.data))
      else p.resolve(msg.result)
      return
    }
    if (isRequest(msg)) {
      this._handleRequest(msg)
      return
    }
    if (isNotification(msg)) {
      try { this._onNotification(msg.method, msg.params) } catch { /* noop */ }
    }
  }

  async _handleRequest(msg) {
    try {
      const result = await this._onRequest(msg.method, msg.params)
      await this._send(makeResponse(msg.id, result))
    } catch (e) {
      const err = e instanceof JsonRpcError ? e : new JsonRpcError(ERR.INTERNAL_ERROR, e?.message || String(e))
      try { await this._send(makeErrorResponse(msg.id, err.code, err.message, err.data)) } catch { /* noop */ }
    }
  }
}
