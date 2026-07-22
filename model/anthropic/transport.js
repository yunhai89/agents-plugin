/**
 * Anthropic 传输层 —— 薄包装共享基座（model/transport-base.js），注入 Anthropic 错误工具集。
 * 与 OpenAI 版的唯一实质差异：默认退避对 529（overloaded）使用更长基础值。
 */

import { createRequestWithRetry, parseRetryAfter } from '../transport-base.js'
import { APIError, TimeoutError, ConnectionError, buildAPIError, isRetryableError } from './errors.js'

export { parseRetryAfter }

/** 指数退避（秒）：min(cap, b*2^attempt) + 抖动；529 过载使用更大基础退避。 */
export function defaultRetryDelay(attempt, status = null, { base = 0.5, cap = 20, jitter = 0.3, overloadBase = 1 } = {}) {
  const b = status === 529 ? overloadBase : base
  const exp = Math.min(cap, b * 2 ** attempt)
  return exp + exp * jitter * Math.random()
}

export const requestWithRetry = createRequestWithRetry({
  APIError,
  TimeoutError,
  ConnectionError,
  buildAPIError,
  isRetryableError,
})
