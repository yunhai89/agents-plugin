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

/** 自动探测公网出口 IP（云服务器经 NAT，自不知公网 IP；调外部 API 获取）。10 分钟缓存。 */
let _publicIp = null
let _publicIpAt = 0
const PRIVATE_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/
async function detectPublicIp() {
  if (_publicIp && Date.now() - _publicIpAt < 600000) return _publicIp
  const apis = ['https://4.ipw.cn', 'https://api.ipify.org', 'https://ifconfig.me/ip']
  for (const url of apis) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000), headers: { 'User-Agent': 'curl/8' } })
      if (!r.ok) continue
      const ip = (await r.text()).trim()
      // 必须是合法公网 IPv4（排除私网/回环，防 API 返回内网代理地址）
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !PRIVATE_RE.test(ip)) {
        _publicIp = ip
        _publicIpAt = Date.now()
        return ip
      }
    } catch { /* 超时 / 无外网 → 试下一个 */ }
  }
  return null
}

/** 解析对外 host：publicUrl（用户配）> 自动探测公网 IP > 内网 IP 兜底 */
async function resolveHost(cfg) {
  const pu = cfg?.publicUrl || ''
  if (pu) {
    const h = pu.replace(/^https?:\/\//, '').replace(/[\/:].*$/, '')
    if (h) return h
  }
  const pub = await detectPublicIp()
  if (pub) return pub
  return detectLanIp()
}

/** #agents登录 命令处理（permission:'master' 已挡权限；群聊提示去私聊） */
export async function handleAgentsLogin(e) {
  const cfg = Config.get().agent?.webApi || {}
  if (cfg.enable === false) { await e.reply('Web 面板未启用（config: agent.webApi.enable）'); return true }
  if (e.isGroup) { await e.reply('为安全，请在私聊对我发送 #agents登录'); return true }
  const port = cfg.port || 6098
  const host = await resolveHost(cfg)
  const token = issueToken(e.user_id)
  const url = `http://${host}:${port}/?token=${token}`
  const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.|::1$)/.test(host)
  Log.mark(`[web] master ${e.user_id} 登录面板`)
  const lines = [
    '🌐 agents-plugin 管理面板（24h 有效，仅你可访问，请勿转发）：',
    url,
  ]
  if (isPrivate) {
    // 服务器自己拿不到公网 IP（NAT/弹性 IP），内网地址外网不可达 → 提示用户配 publicUrl
    lines.push(`⚠️ 上面是服务器内网地址，外网/手机无法直接访问。远程访问请在 config.yaml 配：`)
    lines.push(`   agent.webApi.publicUrl: "http://你的公网IP:${port}"`)
    lines.push(`   保存后 #agents重载，再重新 #agents登录 即得公网地址。本机访问可直接用上面地址或 SSH 端口转发。`)
  } else {
    lines.push(`访问前提：服务器端口 ${port} 需对访问端放行（安全组/防火墙）。`)
  }
  await e.reply(lines.join('\n'))
  return true
}
