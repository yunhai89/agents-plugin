/**
 * OpenAI 传输层 —— 薄包装共享基座（model/transport-base.js），注入 OpenAI 错误工具集。
 * 完整重试/超时/SSE 外围逻辑见基座；这里只声明协议特定的错误归一化。
 */

import { createRequestWithRetry, parseRetryAfter, defaultRetryDelay } from '../transport-base.js'
import { APIError, TimeoutError, ConnectionError, buildAPIError, isRetryableError } from './errors.js'

export { parseRetryAfter, defaultRetryDelay }

export const requestWithRetry = createRequestWithRetry({
  APIError,
  TimeoutError,
  ConnectionError,
  buildAPIError,
  isRetryableError,
})
