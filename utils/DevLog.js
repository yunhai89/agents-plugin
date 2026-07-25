/**
 * DevLog —— 插件自带的详细 trace 日志（框架无关），基于 pino + pino-roll。
 *
 * 目的：开发期把"从触发 AI 到最终回复"的整条链路写进插件自己的文件，
 *   不依赖机器人框架的日志体系（框架默认 debug:false 会吞掉大量信息）。
 *   含：trigger / media / run_start / 每 turn 的请求响应 / 每次工具调用的
 *   参数+状态+返回 / context 压缩 / 反思 / run_end / reply。
 *
 * 输出：pino 结构化 JSONL，按天轮转（pino-roll），位于
 *   <yunzai>/data/agents-plugin/logs/dev.<count>.log（可用 agent.devLog.dir 改）。
 *   不截断——工具返回内容按用户要求完整记录（方便排错）。
 *
 * 框架无关：直接 pino 写文件，不走 Bot.makeLog / logger。
 *   transport(worker)错误被吞，绝不拖垮 bot；初始化失败则关闭 dev 日志。
 *   agent 库不直接 import 本模块；由 apps 注入 devLog 回调（见 Agent.config.devLog）。
 */

import fs from 'node:fs'
import path from 'node:path'
import pino from 'pino'
import Config from './Config.js'

let _logger = null
let _failed = false

function cfg() {
  return Config.get().agent?.devLog || {}
}

/** 懒建 pino logger（按天轮转文件）；未启用/失败返回 null */
function getLogger() {
  if (_failed) return null
  if (cfg().enable === false) return null
  if (_logger) return _logger
  const c = cfg()
  const dir = c.dir ? path.resolve(c.dir) : path.join(Config.path.yunzai, 'data/agents-plugin/logs')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* noop */ }
  try {
    const transport = pino.transport({
      target: 'pino-roll',
      options: { file: path.join(dir, 'dev'), extension: '.log', frequency: 'daily', mkdir: true },
    })
    // transport 跑在 worker，错误绝不冒泡拖垮主进程
    transport.on?.('error', () => {})
    _logger = pino(
      { level: c.level || 'debug', base: null, timestamp: pino.stdTimeFunctions.isoTime },
      transport,
    )
    return _logger
  } catch (e) {
    console.error('[agents-dev] dev 日志初始化失败（已关闭）：', e?.message || e)
    _failed = true
    return null
  }
}

/**
 * 写一条 trace。
 * @param {string} event 事件名（trigger/media/run_start/turn/tool/context_pressure/reflect/run_end/reply/...）
 * @param {object} data 任意结构数据（完整记录，不截断）
 * @param {string|null} traceId 本次 AI 调用的 traceId（串联整条链路；与 Agent taskId 一致）
 */
export default function devLog(event, data = {}, traceId = null) {
  const log = getLogger()
  if (!log) return
  const obj = { event, traceId, ...(data || {}) }
  const isError = data && (data.status === 'error' || data.error || data.resolveError || data.stopReason === 'blocked' || data.stopReason === 'max_turns')
  try { (isError ? log.warn(obj) : log.info(obj)) } catch { /* noop */ }
}

export { devLog }
