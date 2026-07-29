/**
 * Web 面板 API 路由（GET 只读部分；写接口见 C 阶段补充）。
 * 形状严格对齐 web/assets/js/mock.js（事实标准，非文档 TS）：
 *  - recall/conversations 返回裸数组；memories = {usedChars,limitChars,entries}
 *  - config 出口过 redactConfig（MaskedValue）
 * 文件型端点（config/scopes/logs）不依赖 runtime；KV/runtime 型调 getRuntime，失败返 5000。
 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import Config from '../../utils/Config.js'
import { setPath } from '../../utils/path.js'
import { getRuntime, fireReminder } from '../../apps/agent.js'
import { redactConfig } from './redact.js'
import { listLogFiles, readLogFile, aggregateStats, queryLogFiles } from './logs.js'
import { ok, fail, asyncHandler, CODE } from './response.js'
import { listAllSuggestions, applySuggestion, removeSuggestion } from '../evolution/review.js'

const router = express.Router()

/** 取运行时；失败则响应 5000 并返回 null（handler 据此中断） */
async function getRt(res) {
  try { return await getRuntime() }
  catch (e) {
    fail(res, CODE.INTERNAL, `运行时未就绪：${e?.message || '可能 apiKey 未配'}`)
    return null
  }
}

// ───────────────── 文件型（不依赖 runtime） ─────────────────

// GET /api/config —— 全量配置（脱敏后）
router.get('/config', asyncHandler(async (req, res) => {
  const agent = Config.get().agent || {}
  return ok(res, redactConfig(agent))
}))

// GET /api/scopes —— 数据隔离维度列表（扫 memories 目录反解 scopeId）
router.get('/scopes', asyncHandler(async (req, res) => {
  const dir = Config.path.memories
  const out = []
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      try { if (!fs.statSync(`${dir}/${name}`).isDirectory()) continue } catch { continue }
      const m = name.match(/^(?:u_(\d+)|g(\d+)_u(\d+)|g(\d+))$/)
      if (!m) continue
      let type, userId, groupId
      if (m[1]) { type = 'private'; userId = m[1]; groupId = null }
      else if (m[2]) { type = 'group'; groupId = m[2]; userId = m[3] }
      else { type = 'group'; groupId = m[4]; userId = '' }
      const label = type === 'private'
        ? `私聊 · ${userId}`
        : (userId ? `群${groupId} · ${userId}` : `群${groupId} · 共享`)
      out.push({ scopeId: name, type, label, userId, groupId })
    }
  }
  return ok(res, out)
}))

// GET /api/logs/files —— 会话日志文件列表（默认最新10条；支持 from/to/event/q 筛选）。返回 {items,total}
router.get('/logs/files', asyncHandler(async (req, res) => {
  const { from, to, event, q } = req.query
  const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 10
  return ok(res, queryLogFiles(Config.path.logs, { from, to, event, q, limit }))
}))

// GET /api/logs?file= —— 单文件事件流（{file,label,events}，对齐 mock）
router.get('/logs', asyncHandler(async (req, res) => {
  const file = String(req.query.file || '')
  if (!file) return fail(res, CODE.BAD, '缺少 file 参数')
  const all = listLogFiles(Config.path.logs)
  const meta = all.find((f) => f.file === file)
  if (!meta) return fail(res, CODE.NOTFOUND, '日志文件不存在')
  const events = readLogFile(Config.path.logs, file)
  return ok(res, { file, label: meta.label, events })
}))

// ───────────────── runtime 型（依赖 getRuntime） ─────────────────

// GET /api/memories?scopeId= —— 声明式记忆双文件
router.get('/memories', asyncHandler(async (req, res) => {
  const scopeId = String(req.query.scopeId || '')
  if (!scopeId) return fail(res, CODE.BAD, '缺少 scopeId')
  const r = await getRt(res); if (!r) return
  const mem = r.memory
  const wrap = (target) => (!mem ? { usedChars: 0, limitChars: 0, entries: [] } : {
    usedChars: mem.used(target, scopeId) || 0,
    limitChars: mem.limits[target] || 0,
    entries: mem.getEntries(target, scopeId) || [],
  })
  return ok(res, { memory: wrap('memory'), user: wrap('user') })
}))

// GET /api/personas —— 人设库（内置 + 自定义）
router.get('/personas', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  return ok(res, r.personaStore.list())
}))

// GET /api/skills —— 技能列表
router.get('/skills', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  return ok(res, r.skills.list())
}))

// GET /api/conversations?userId=&groupId= —— 对话列表（裸数组）
router.get('/conversations', asyncHandler(async (req, res) => {
  const userId = String(req.query.userId || '')
  if (!userId) return fail(res, CODE.BAD, '缺少 userId')
  const r = await getRt(res); if (!r) return
  const groupId = req.query.groupId || 'private'
  const list = await r.session.listConversations(userId, groupId).catch(() => [])
  return ok(res, list)
}))

// GET /api/sessions?convId=&userId=&groupId= —— 会话消息
router.get('/sessions', asyncHandler(async (req, res) => {
  const { convId, userId } = req.query
  if (!convId || !userId) return fail(res, CODE.BAD, '缺少 convId/userId')
  const r = await getRt(res); if (!r) return
  const groupId = req.query.groupId || 'private'
  const messages = await r.session.getConversation(userId, groupId, convId).catch(() => [])
  const meta = await r.session.getConversationMeta(userId, groupId, convId).catch(() => null)
  return ok(res, {
    key: r.session.convKey(userId, groupId, convId),
    scopeUserId: userId,
    updatedAt: meta?.updatedAt || Date.now(),
    messages,
  })
}))

// GET /api/recall?userId= —— 长期记忆（裸数组）
router.get('/recall', asyncHandler(async (req, res) => {
  const userId = String(req.query.userId || '')
  if (!userId) return fail(res, CODE.BAD, '缺少 userId')
  const r = await getRt(res); if (!r) return
  const list = await r.recall.listByUser(userId).catch(() => [])
  return ok(res, list)
}))

// GET /api/schedule —— 定时任务
router.get('/schedule', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const list = await r.schedule.listAll().catch(() => [])
  return ok(res, list)
}))

// GET /api/confirm —— 待审批队列（内存态）
router.get('/confirm', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  return ok(res, r.confirm.list())
}))

// GET /api/suggestions?scopeId=&status= —— 进化建议（全部 status）
router.get('/suggestions', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const list = listAllSuggestions(r.suggestionDir, {
    scopeId: req.query.scopeId || undefined,
    status: req.query.status || undefined,
  })
  return ok(res, list)
}))

// ── Tool Evolution（工具进化：版本/状态/审批）──
// GET /api/tevo/tools —— 所有工具版本（id/tool_id/semver/status/source_hash/created_at）
router.get('/tevo/tools', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  if (!r.toolEvo?.registry) return ok(res, [])
  return ok(res, await r.toolEvo.registry.listVersions())
}))

// POST /api/tevo/tools/:versionId/approve —— verified→stable 并注入 ToolRegistry
router.post('/tevo/tools/:versionId/approve', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  if (!r.toolEvo?.registry) return fail(res, CODE.BAD, '工具进化未启用')
  const reg = r.toolEvo.registry
  const v = await reg.getVersion(req.params.versionId)
  if (!v) return fail(res, CODE.NOTFOUND, '版本不存在')
  if (v.status !== 'verified') return fail(res, CODE.BAD, `仅 verified 候选可采纳（当前 ${v.status}）`)
  await reg.setStatus(req.params.versionId, 'stable', { actor: 'web:' + (req.master || 'unknown'), reason: 'web 面板采纳' })
  const stable = (await reg.listStable()).find((s) => s.versionId === req.params.versionId)
  if (stable) r.tools.register(await reg.toToolContract(stable))
  return ok(res, { versionId: req.params.versionId, status: 'stable' }, '已晋升 stable 并注入')
}))

// POST /api/tevo/tools/:versionId/decommission —— 淘汰（deprecated + 卸载）
router.post('/tevo/tools/:versionId/decommission', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  if (!r.toolEvo?.registry) return fail(res, CODE.BAD, '工具进化未启用')
  const reg = r.toolEvo.registry
  const v = await reg.getVersion(req.params.versionId)
  if (!v) return fail(res, CODE.NOTFOUND, '版本不存在')
  await reg.setStatus(req.params.versionId, 'deprecated', { actor: 'web:' + (req.master || 'unknown'), reason: 'web 面板淘汰' })
  r.tools.unregister(v.manifest.name)
  return ok(res, { versionId: req.params.versionId, status: 'deprecated' }, '已淘汰并卸载')
}))

// GET /api/overview —— 概览聚合（60s 缓存）
let _overviewCache = null
router.get('/overview', asyncHandler(async (req, res) => {
  if (_overviewCache && Date.now() - _overviewCache.at < 60000) return ok(res, _overviewCache.data)
  const r = await getRuntime().catch(() => null)
  const since = Date.now() - 7 * 86400000
  const { tokenTrend, toolTop } = aggregateStats(Config.path.logs, { since, topK: 5 })
  // perceptions（kv.scan）
  const perceptions = []
  if (r?.kv) {
    try {
      const mets = (await r.kv.scan('perception:met:')) || []
      for (const k of mets) {
        const groupId = k.slice('perception:met:'.length)
        const met = await r.kv.get(k).catch(() => null)
        const lastActive = await r.kv.get(`perception:last_active:${groupId}`).catch(() => null)
        if (met) perceptions.push({ groupId, met, lastActive: lastActive || { at: met.at || 0 } })
      }
    } catch { /* noop */ }
  }
  const counts = {
    pendingConfirms: r ? r.confirm.list().length : 0,
    pendingSuggestions: r ? listAllSuggestions(r.suggestionDir, { status: 'pending' }).length : 0,
    scopes: fs.existsSync(Config.path.memories) ? fs.readdirSync(Config.path.memories).length : 0,
  }
  const data = { tokenTrend, toolTop, perceptions, counts }
  _overviewCache = { at: Date.now(), data }
  return ok(res, data)
}))

// ───────────────── 写操作（9 类，成功触发 Config 热加载或落盘） ─────────────────

// PUT /api/config —— 点路径 changes（对齐锅巴 setConfigData）
router.put('/config', asyncHandler(async (req, res) => {
  const { changes } = req.body || {}
  if (!changes || typeof changes !== 'object') return fail(res, CODE.BAD, 'changes 必须是对象')
  const cfg = Config.get()
  let n = 0
  for (const [p, v] of Object.entries(changes)) {
    if (!p.startsWith('agent.')) continue // 仅允许 agent.* 命名空间
    setPath(cfg, p, v)
    n++
  }
  Config.save(cfg)
  Config.reload(true)
  return ok(res, { applied: n }, '已保存（已热加载）')
}))

// PUT /api/memories/:scopeId/:target —— 全量替换条目（超限 4001）
router.put('/memories/:scopeId/:target', asyncHandler(async (req, res) => {
  const { scopeId, target } = req.params
  if (target !== 'memory' && target !== 'user') return fail(res, CODE.BAD, 'target 必须是 memory|user')
  const entries = req.body?.entries
  if (!Array.isArray(entries)) return fail(res, CODE.BAD, 'entries 必须是字符串数组')
  const r = await getRt(res); if (!r) return
  try {
    const result = r.memory.setAll(target, entries, scopeId)
    return ok(res, result)
  } catch (e) {
    if (e?.name === 'MemoryLimitError' || /超限/.test(e?.message || '')) return fail(res, CODE.BAD, e.message)
    throw e
  }
}))

// POST /api/recall/:userId —— 新增（写入过威胁扫描）
router.post('/recall/:userId', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const { level, type, content, confidence } = req.body || {}
  if (!content) return fail(res, CODE.BAD, '缺少 content')
  const result = await r.recall.writeMemory(
    { level: level || 'L3', type: type || 'fact', content: String(content), confidence: Number(confidence) || 0.5 },
    req.params.userId,
  )
  return ok(res, result)
}))

// DELETE /api/recall/:userId/:entryId —— 按 id 删
router.delete('/recall/:userId/:entryId', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const removed = await r.recall.removeById(req.params.userId, req.params.entryId)
  return ok(res, { removed })
}))

// POST /api/personas —— 新建自定义人设
router.post('/personas', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  try { return ok(res, r.personaStore.add(req.body, { creator: req.master })) }
  catch (e) { return fail(res, CODE.BAD, e.message) }
}))

// PUT /api/personas/:id —— 编辑（内置 4003）
router.put('/personas/:id', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  try { return ok(res, r.personaStore.update(req.params.id, req.body)) }
  catch (e) { const msg = e.message || ''; return fail(res, /内置/.test(msg) ? CODE.READONLY : CODE.BAD, msg) }
}))

// DELETE /api/personas/:id —— 删除（内置 4003）
router.delete('/personas/:id', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  try { return ok(res, { removed: r.personaStore.remove(req.params.id) }) }
  catch (e) { const msg = e.message || ''; return fail(res, /内置/.test(msg) ? CODE.READONLY : CODE.BAD, msg) }
}))

// POST /api/schedule —— 新建定时任务（注入 fireReminder 回调）
router.post('/schedule', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const { userId, groupId, message, at } = req.body || {}
  if (!userId || !message || !at) return fail(res, CODE.BAD, '缺少 userId/message/at')
  const info = { userId: String(userId), groupId: groupId || null, selfId: '', at: Number(at), message: String(message) }
  const ret = await r.schedule.add(info, fireReminder)
  const id = ret && typeof ret === 'object' ? ret.id : ret
  return ok(res, { id })
}))

// DELETE /api/schedule/:id —— 取消
router.delete('/schedule/:id', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const ret = await r.schedule.cancel(req.params.id)
  return ok(res, { removed: ret ? 1 : 0 })
}))

// POST /api/confirm/:id/decide —— 审批决策（不存在/超时 4004）
router.post('/confirm/:id/decide', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const exists = r.confirm.list().some((c) => c.id === req.params.id)
  if (!exists) return fail(res, CODE.NOTFOUND, '审批项不存在或已超时')
  r.confirm.resolve(req.params.id, !!req.body?.approve)
  return ok(res, { decided: true })
}))

// POST /api/suggestions/:id/apply —— 应用（失败置 apply_failed）
router.post('/suggestions/:id/apply', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const s = listAllSuggestions(r.suggestionDir).find((x) => x.id === req.params.id)
  if (!s) return fail(res, CODE.NOTFOUND, 'suggestion 不存在')
  try {
    const applyResult = await applySuggestion(r, s)
    return ok(res, { ...s, status: 'applied', applyResult })
  } catch (e) {
    s.status = 'apply_failed'
    s.error = e.message
    try { fs.writeFileSync(path.join(r.suggestionDir, String(s.scopeId), `${s.id}.json`), JSON.stringify(s, null, 2)) } catch { /* noop */ }
    return fail(res, CODE.INTERNAL, e.message)
  }
}))

// DELETE /api/suggestions/:id —— 驳回（删除文件）
router.delete('/suggestions/:id', asyncHandler(async (req, res) => {
  const r = await getRt(res); if (!r) return
  const s = listAllSuggestions(r.suggestionDir).find((x) => x.id === req.params.id)
  if (!s) return fail(res, CODE.NOTFOUND, 'suggestion 不存在')
  removeSuggestion(r.suggestionDir, s.scopeId, s.id)
  return ok(res, { removed: true })
}))

// 未知 /api 路径 → JSON 404（不走 SPA fallback）
router.use((req, res) => fail(res, CODE.NOTFOUND, `未知接口 ${req.method} ${req.path}`))

export function buildApiRouter() {
  return router
}
