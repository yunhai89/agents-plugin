/**
 * DevLog —— 插件自带的详细 trace 日志（框架无关），基于 pino。
 *
 * 目的：开发期把"从触发 AI 到最终回复"的整条链路写进插件自己的文件，
 *   不依赖机器人框架的日志体系（框架默认 debug:false 会吞掉大量信息）。
 *   含：trigger / media / input / 每 turn 的请求响应 / 每次工具调用的
 *   参数+状态+返回 / context 压缩 / 反思 / run_end / reply。
 *
 * 输出：pino 结构化 JSONL。按【会话】分文件，位于
 *   <插件>/data/logs/<群号>-<用户>-<会话id>-<会话创建时间>.log
 *   （可用 agent.devLog.dir 改目录）。同一会话(conversation)的多轮 AI 请求（各带 uuidv4 traceId）
 *   追加到同一文件；scope 缺失（旧调用/异常）回退 dev-fallback.log。
 *   不截断——工具返回内容按用户要求完整记录（方便排错）。
 *
 * 实现：pino.destination 同步 append 写单文件（无 transport worker，杜绝 worker 错误被吞
 *   导致"日志不输出"）。Map<filename,logger> 缓存（上限 64，LRU 防 fd 泄露）。
 *   框架无关：直接 pino 写文件，不走 Bot.makeLog / logger。
 *   容错：pino 未装/初始化失败 → 关 dev 日志（_failed），绝不拖垮 bot。
 *   库零依赖：agent 库不直接 import 本模块；由 apps 注入 devLog 回调（见 Agent.config.devLog）。
 */

import fs from 'node:fs'
import path from 'node:path'
import Config from './Config.js'

let _failed = false
let _pino = null
const _loggers = new Map() // filename → pino logger
const LOGGER_CAP = 64

function cfg() {
  return Config.get().agent?.devLog || {}
}

/** 把毫秒时间戳格式化为文件名用的紧凑形式 YYYYMMDD-HHmm */
function fmtTime(ms) {
  const d = new Date(ms || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * scope → 日志文件名。<群号>-<用户>-<会话id>-<创建时间>.log
 * 与 #上报错误 的 glob 前缀（<群号>-<用户>-<会话id>-*.log）保持一致。
 */
export function devLogFilename({ gid, uid, convId, createdAt } = {}) {
  const g = gid || 'private'
  const u = uid || 'unknown'
  const c = convId || '0'
  return `${g}-${u}-${c}-${fmtTime(createdAt)}.log`
}

/** 懒加载 pino（未装则 _failed，dev 日志关闭） */
async function loadPino() {
  if (_pino) return _pino
  try {
    const m = await import('pino')
    _pino = m.default || m
    return _pino
  } catch (e) {
    console.warn('[agents-dev] pino 未装，dev 日志关闭：', e?.code || e?.message || e)
    _failed = true
    return null
  }
}

/** 取/建某文件的 pino logger（同步 destination，无 worker）；LRU 上限防 fd 泄露 */
function getLoggerFor(filename) {
  if (_loggers.has(filename)) {
    const l = _loggers.get(filename)
    _loggers.delete(filename); _loggers.set(filename, l) // refresh LRU 顺序
    return l
  }
  const c = cfg()
  const dir = c.dir ? path.resolve(c.dir) : Config.path.logs
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* noop */ }
  let logger
  try {
    logger = _pino(
      { level: c.level || 'debug', base: null, timestamp: _pino.stdTimeFunctions.isoTime },
      _pino.destination(path.join(dir, filename)),
    )
  } catch (e) {
    console.warn('[agents-dev] logger 创建失败：', e?.message || e)
    _failed = true
    return null
  }
  if (_loggers.size >= LOGGER_CAP) {
    const oldest = _loggers.keys().next().value
    try { _loggers.get(oldest)?.end?.() } catch { /* noop */ }
    _loggers.delete(oldest)
  }
  _loggers.set(filename, logger)
  return logger
}

/**
 * 写一条 trace。
 * @param {string} event 事件名（trigger/media/input/run_start/turn/tool/context_pressure/reflect/run_end/reply/...）
 * @param {object} data 任意结构数据（完整记录，不截断）
 * @param {string|null} traceId 本次 AI 调用的 traceId（串联整条链路；与 Agent taskId 一致）
 * @param {object|null} scope {gid,uid,convId,createdAt} —— 决定写哪个会话文件；缺则 dev-fallback.log
 */
export default async function devLog(event, data = {}, traceId = null, scope = null) {
  if (_failed) return
  if (cfg().enable === false) return
  if (!_pino) await loadPino()
  if (_failed || !_pino) return
  const filename = scope ? devLogFilename(scope) : 'dev-fallback.log'
  const log = getLoggerFor(filename)
  if (!log) return
  const obj = { event, traceId, ...(data || {}) }
  const isError = data && (data.status === 'error' || data.error || data.resolveError || data.stopReason === 'blocked' || data.stopReason === 'max_turns')
  try { (isError ? log.warn(obj) : log.info(obj)) } catch { /* noop */ }
}

export { devLog }
