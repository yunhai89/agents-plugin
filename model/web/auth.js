/**
 * Web 面板鉴权：主人私聊 #agents登录 → 发 token（24h，滑动续期）→ 前端 URL ?token= 转 localStorage → Authorization Bearer。
 *
 * 纯内存 Map（模块级单例，Yunzai 热重载不丢；进程重启需重新登录）。
 * 故意不依赖 getRuntime()/KV——apiKey 未配时用户仍能登录面板填配置（运行时恢复前置）。
 */
import crypto from 'node:crypto'
import os from 'node:os'
import Config from '../../utils/Config.js'
import Log from '../../utils/Log.js'

const TTL_MS = 24 * 60 * 60 * 1000
const _tokens = new Map() // token -> { masterId, createdAt, expiresAt }

/** 签发 token（绑定 masterId） */
export function issueToken(masterId) {
  const token = crypto.randomBytes(24).toString('hex')
  const now = Date.now()
  _tokens.set(token, { masterId: String(masterId), createdAt: now, expiresAt: now + TTL_MS })
  return token
}

/** 校验 token；命中且未过期则滑动续期 24h，返回 { masterId }；否则 null */
export function verifyToken(token) {
  if (!token) return null
  const r = _tokens.get(token)
  if (!r) return null
  if (Date.now() > r.expiresAt) { _tokens.delete(token); return null }
  r.expiresAt = Date.now() + TTL_MS
  return r
}

/** 撤销（登出/泄露应急） */
export function revokeToken(token) {
  return _tokens.delete(token)
}

/** express 中间件：校验 Authorization: Bearer <token> 或 ?token=（仅登录直跳用） */
export async function authMiddleware(req, res, next) {
  const tok = (req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim() || String(req.query.token || '')
  const r = verifyToken(tok)
  if (!r) return res.status(401).json({ code: 4010, data: null, msg: '未认证或 token 已失效，请重新 #agents登录' })
  req.master = r.masterId
  return next()
}

/** 探测本机 LAN IP（跳过内环 / docker / br / veth 虚拟网卡） */
export function detectLanIp() {
  try {
    const nets = os.networkInterfaces()
    for (const [ifname, list] of Object.entries(nets)) {
      if (/^(docker|br-|veth|virbr)/.test(ifname)) continue
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) return n.address
      }
    }
  } catch { /* noop */ }
  return '127.0.0.1'
}

function resolveHost(cfg) {
  const pu = cfg?.publicUrl || ''
  if (pu) {
    const h = pu.replace(/^https?:\/\//, '').replace(/[\/:].*$/, '')
    if (h) return h
  }
  return detectLanIp()
}

/** #agents登录 命令处理（permission:'master' 已挡权限；群聊提示去私聊） */
export async function handleAgentsLogin(e) {
  const cfg = Config.get().agent?.webApi || {}
  if (cfg.enable === false) { await e.reply('Web 面板未启用（config: agent.webApi.enable）'); return true }
  if (e.isGroup) { await e.reply('为安全，请在私聊对我发送 #agents登录'); return true }
  const port = cfg.port || 6098
  const host = resolveHost(cfg)
  const token = issueToken(e.user_id)
  const url = `http://${host}:${port}/?token=${token}`
  Log.mark(`[web] master ${e.user_id} 登录面板`)
  await e.reply([
    '🌐 agents-plugin 管理面板（24h 有效，仅你可访问，请勿转发）：',
    url,
    `访问前提：服务器端口 ${port} 需对访问端放行（安全组/防火墙）。`,
  ].join('\n'))
  return true
}
