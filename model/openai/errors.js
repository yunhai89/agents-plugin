/**
 * OpenAI 兼容 API 的错误类型与重试判定（对应协议文档第 6 节）。
 */

/** 可重试的 HTTP 状态码：超时 / 限流(非额度不足) / 服务端错误 / 529 过载(Anthropic 风格) */
export const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 524, 529])

/**
 * OpenAI 兼容 API 错误。
 * 网络/超时错误会被归一为本类（status=null，按子类区分）。
 */
export class APIError extends Error {
  constructor({
    message = 'OpenAI API error',
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

  /** 429（非 insufficient_quota）/ 5xx / 408 等可重试 */
  get isRetryable() {
    if (this.status === 429) return this.code !== 'insufficient_quota'
    return RETRYABLE_STATUSES.has(this.status)
  }
}

/** 请求超时（AbortController 触发）—— 可重试 */
export class TimeoutError extends APIError {
  constructor(message = 'Request timed out', { headers = null, cause } = {}) {
    super({ message, status: null, headers, cause })
    this.name = 'TimeoutError'
  }
  get isRetryable() {
    return true
  }
}

/** 网络连接错误（DNS/断网/重置等）—— 可重试 */
export class ConnectionError extends APIError {
  constructor(message = 'Connection error', { headers = null, cause } = {}) {
    super({ message, status: null, headers, cause })
    this.name = 'ConnectionError'
  }
  get isRetryable() {
    return true
  }
}

/** 网络/超时错误一律可重试；HTTP 错误交给 APIError.isRetryable */
export function isRetryableError(err) {
  if (err instanceof TimeoutError || err instanceof ConnectionError) return true
  if (err instanceof APIError) return err.isRetryable
  return false
}

/** 从已解析的错误响应体（OpenAI 标准 {error:{message,type,code,param}}）构造 APIError */
export function buildAPIError(status, body, headers = null) {
  const e = body && typeof body === 'object' && body.error ? body.error : body || {}
  const requestID = headers?.get ? headers.get('x-request-id') : null
  return new APIError({
    message: e.message || `OpenAI API error (HTTP ${status})`,
    status,
    type: e.type ?? null,
    code: e.code ?? null,
    param: e.param ?? null,
    requestID,
    headers,
  })
}
