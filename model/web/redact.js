/**
 * 配置出口脱敏：把敏感字段转 MaskedValue = { configured:boolean, preview?:string }。
 * 与 web/assets/js/mock.js 的 <masked-value> 契约一致（前端据 configured 显示"已配置/未配置"，preview 可选）。
 *
 * 规则（按键名递归匹配 + masters/mcp 特殊处理）：
 *  - apiKey 类 → 前3+****+末4（如 sk-****a3f9；短于8位 → ****）
 *  - baseURL   → 完整 URL 当 preview（非密钥但统一脱敏显示）
 *  - proxy/cookie/refreshToken → 仅 configured（绝不出 preview，防内网/会话泄露）
 *  - masters[] → 每元素 QQ 前4+****
 *  - mcp.servers.*.env.*   → 仅 configured（每键值，最安全）
 *  - mcp.servers.*.headers.* → 前3+****+末4（如 Bearer ****9f）
 *
 * GET /api/config 出口必须过 redactConfig；PUT 写入明文后，下次 GET 再次脱敏——前后端永不存在明文回显。
 */

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)))

const KEY_RULES = {
  apiKey: 'key',
  baseURL: 'url',
  proxy: 'flag',
  cookie: 'flag',
  refreshToken: 'flag',
}

function maskKey(v) {
  const s = String(v ?? '')
  if (!s) return { configured: false }
  const preview = s.length >= 8 ? `${s.slice(0, 3)}-****${s.slice(-4)}` : '****'
  return { configured: true, preview }
}
function maskUrl(v) {
  const s = String(v ?? '')
  return s ? { configured: true, preview: s } : { configured: false }
}
function maskFlag(v) {
  const configured = typeof v === 'string' ? s_trim(v).length > 0 : (v != null && v !== false)
  return { configured }
}
function s_trim(s) { return String(s ?? '').trim() }

function maskMaster(qq) {
  const s = String(qq ?? '')
  return { configured: true, preview: s.length >= 4 ? `${s.slice(0, 4)}****` : '****' }
}

/** mcp.servers.*.env/headers 每键值转 MaskedValue（键名动态，单独遍历） */
function maskMcpServers(servers) {
  if (!servers || typeof servers !== 'object') return servers
  const out = {}
  for (const [name, srv] of Object.entries(servers)) {
    if (!srv || typeof srv !== 'object') { out[name] = srv; continue }
    const s = { ...srv }
    if (s.env && typeof s.env === 'object') {
      const env = {}
      for (const [ek, ev] of Object.entries(s.env)) env[ek] = maskFlag(ev)
      s.env = env
    }
    if (s.headers && typeof s.headers === 'object') {
      const h = {}
      for (const [hk, hv] of Object.entries(s.headers)) h[hk] = maskKey(hv)
      s.headers = h
    }
    out[name] = s
  }
  return out
}

/** 递归按键名脱敏（apiKey/baseURL/proxy/cookie/refreshToken + masters 数组） */
function walkMask(obj) {
  if (Array.isArray(obj)) return obj.map(walkMask)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k in KEY_RULES) {
        const rule = KEY_RULES[k]
        out[k] = rule === 'key' ? maskKey(v) : rule === 'url' ? maskUrl(v) : maskFlag(v)
      } else if (k === 'masters' && Array.isArray(v)) {
        out[k] = v.map(maskMaster)
      } else {
        out[k] = walkMask(v)
      }
    }
    return out
  }
  return obj
}

/** 入口：深拷贝 agent 配置 → 递归脱敏。绝不修改原 Config。 */
export function redactConfig(agentCfg) {
  if (!agentCfg || typeof agentCfg !== 'object') return agentCfg
  const masked = walkMask(clone(agentCfg))
  if (masked.mcp?.servers) masked.mcp.servers = maskMcpServers(masked.mcp.servers)
  return masked
}
