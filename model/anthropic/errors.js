/**
 * Anthropic Messages API 错误类型与重试判定（对应协议文档第 11 节）。
 * Anthropic 错误体：{ type:'error', error:{ type, message } }
 */

/** 可重试状态：限流(429)、服务端错误(500/502/503/504)、Anthropic 过载(529)、超时(408) */
export const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 524, 529])

export class APIError extends Error {
  constructor({
    message = 'Anthropic API error',
    status = null,
    type = null,
    code = null,
    param = null,
    requestID = null,
    headers = null,
    cause,
  } = {}) {
    super(message, { cause })
    this.name = 'APIError'
    this.status = status
    this.type = type
    this.code = code
    this.param = param
    this.requestID = requestID
    this.headers = headers
  }

  /** 429 / 5xx / 529(overloaded) 可重试 */
  get isRetryable() {
    return RETRYABLE_STATUSES.has(this.status)
  }
}

export class TimeoutError extends APIError {
  constructor(message = 'Request timed out', { headers = null, cause } = {}) {
    super({ message, status: null, headers, cause })
    this.name = 'TimeoutError'
  }
  get isRetryable() {
    return true
  }
}

export class ConnectionError extends APIError {
  constructor(message = 'Connection error', { headers = null, cause } = {}) {
    super({ message, status: null, headers, cause })
    this.name = 'ConnectionError'
  }
  get isRetryable() {
    return true
  }
}

export function isRetryableError(err) {
  if (err instanceof TimeoutError || err instanceof ConnectionError) return true
  if (err instanceof APIError) return err.isRetryable
  return false
}

/**
 * 从已解析的 Anthropic 错误体构造 APIError。
 * 标准格式 { type:'error', error:{ type, message } }；也兼容 { error:{...} } / 裸对象。
 */
export function buildAPIError(status, body, headers = null) {
  const e = body && typeof body === 'object' && body.error ? body.error : body || {}
  const requestID = headers?.get ? headers.get('request-id') : null
  return new APIError({
    message: e.message || `Anthropic API error (HTTP ${status})`,
    status,
    type: e.type ?? null,
    code: e.code ?? null,
    param: e.param ?? null,
    requestID,
    headers,
  })
}
