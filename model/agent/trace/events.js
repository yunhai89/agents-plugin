/**
 * Agent 事件 schema + 构造器（Event Bus 雏形，阶段0.5）。
 *
 * 给 devLog event 加结构化头 {type, ts, traceId, spanId, turn, seq}，并提供：
 *  - tokenBreakdown：system/tools/memory/skills/conversation 分段 token 估算（阶段1 降级依据）
 *  - toolResultFields：把 tool result 结构化为 {success, duration, errorClass, summary}
 *  - decisionFields：tool_selection 的 available/selected/rejected
 *
 * 向后兼容：构造器生成的字段并入 devLog 的 data（...data 展开），老解析（按 event 名）不受影响。
 * span 不引入完整 OpenTelemetry——用 traceId + turn 序号 + ts 即可推导 span 树（LLM/Tool/Memory 段耗时）。
 */

let _seq = 0
/** 全局递增序号（事件顺序，append 文件内同 traceId 的 event 按seq排序） */
export function nextSeq() { return ++_seq }

/** 统一结构化头（并入 event data） */
export function eventHead({ traceId, spanId = null, turn = null }) {
  return { ts: Date.now(), traceId, spanId, turn, seq: nextSeq() }
}

/** 默认 token 估算（字符数/4）；Agent 可注入更准的 estimateTokens */
const defaultEst = (t) => Math.ceil(String(t || '').length / 4)

/**
 * token 分段估算：把 system prompt 各部分 + 工具数组 + 对话历史拆成可归因段。
 * @param parts { identity, service, context, guard, toolCatalog, toolListTokens, recalledMemory, memorySnapshot, skills, sticker, conversationTokens }
 */
export function tokenBreakdown(parts, est = defaultEst) {
  const fn = typeof est === 'function' ? est : defaultEst
  const identity = fn(parts.identity) + fn(parts.service) + fn(parts.context) + fn(parts.guard)
  const tools = fn(parts.toolCatalog) + (Number(parts.toolListTokens) || 0)
  const memory = fn(parts.recalledMemory) + fn(parts.memorySnapshot)
  const skills = fn(parts.skills) + fn(parts.sticker)
  const conversation = Number(parts.conversationTokens) || 0
  return { identity, tools, memory, skills, conversation, total: identity + tools + memory + skills + conversation }
}

/** 从工具 result 内容提取摘要（截断 + 关键字段），避免日志被超长输出撑爆 */
function briefResult(result) {
  const r = String(result ?? '')
  try {
    const o = JSON.parse(r)
    if (o && typeof o === 'object') {
      if (o.error) return `error: ${String(o.error).slice(0, 120)}`
      // terminal 类：提取 exitCode/stdout 摘要
      if ('exitCode' in o || 'stdout' in o) return `exit=${o.exitCode} stdout=${String(o.stdout || '').slice(0, 80)}`
      return JSON.stringify(o).slice(0, 120)
    }
    return r.slice(0, 120)
  } catch { return r.slice(0, 120) }
}

/**
 * tool 调用结果结构化（并入 tool event data）。
 * @param {object} p { name, args, result, ok, ms, errorClass? }
 */
export function toolResultFields({ name, ok, ms, result, errorClass = null }) {
  const isError = ok === false
  return {
    name,
    success: !isError,
    duration: Number.isFinite(ms) ? ms : null,
    errorClass: isError ? (errorClass || (String(result || '').includes('"error"') ? 'tool_error' : 'failed')) : null,
    summary: briefResult(result),
  }
}

/**
 * tool_selection decision 结构化。
 * @param {object} p { query, available:[{name,score}], selected:[name], threshold }
 */
export function decisionFields({ query, available = [], selected = [], threshold = null }) {
  const sel = new Set(selected)
  const rejected = available.filter((a) => !sel.has(a.name)).map((a) => ({ name: a.name, score: a.score, reason: a.score < (threshold || 0) ? 'below_threshold' : 'not_selected' }))
  return {
    query: String(query || '').slice(0, 80),
    availableCount: available.length,
    available: available.slice(0, 8).map((a) => ({ name: a.name, score: a.score })),
    selected,
    rejected: rejected.slice(0, 8),
    threshold,
  }
}

export default { eventHead, tokenBreakdown, toolResultFields, decisionFields, nextSeq }
