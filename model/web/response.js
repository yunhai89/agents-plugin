/**
 * Web API 响应包络 + 错误码 + async handler 包装。
 * 统一 { code, data, msg }；失败带合适 HTTP 状态码。前端 request.js 据此解包。
 */

export const CODE = {
  OK: 0,
  BAD: 4001, // 校验失败（字符上限/类型不符）
  READONLY: 4003, // 目标只读（内置人设/技能）
  NOTFOUND: 4004, // 资源不存在或已过期（审批/任务）
  UNAUTH: 4010, // 未认证 / 非 master
  INTERNAL: 5000, // 服务器内部错误
}

const HTTP_STATUS = { 4001: 400, 4003: 403, 4004: 404, 4010: 401, 5000: 500 }

export function ok(res, data = {}, msg = 'ok') {
  return res.json({ code: 0, data, msg })
}

export function fail(res, code, msg) {
  return res.status(HTTP_STATUS[code] || 400).json({ code, data: null, msg: msg || '' })
}

/** 包裹 async 路由 handler：抛错 → errorMiddleware（code:5000）。express 5 自带 async 错误传递，此为保险。 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

/** express 错误中间件：兜底 5000，msg 带摘要（不泄露完整堆栈给前端） */
export function errorMiddleware(err, _req, res, _next) {
  if (res.headersSent) return undefined
  return fail(res, CODE.INTERNAL, err?.message || String(err))
}
