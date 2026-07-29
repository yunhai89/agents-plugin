/**
 * devLog 解析与聚合（供 /api/logs、/api/overview 用）。
 *
 * devLog 文件（utils/DevLog.js）每事件写 JSON.stringify(obj, null, 2) + '\n'（缩进多行 JSON）。
 * 文件名：<gid>-<uid>-<convId>-<YYYYMMDDHHmmss>.log；私聊为 private-<uid>-<conv>-<ts>.log。
 * 事件体 { level, time(ISO), event, traceId, ...payload }；12 种 event。
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * 解析 devLog 文本（含多个缩进 JSON 对象）→ LogEvent[]。
 * 按顶层 {} 深度 + 字符串转义切分（借鉴 recall.js extractJsonArray 的扫描思路）。
 */
export function parseDevLog(text) {
  const events = []
  const s = String(text || '')
  let i = 0
  while (i < s.length) {
    const start = s.indexOf('{', i)
    if (start < 0) break
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let j = start; j < s.length; j++) {
      const ch = s[j]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
      } else if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { end = j; break } }
    }
    if (end < 0) break
    try { events.push(JSON.parse(s.slice(start, end + 1))) } catch { /* 跳过损坏对象 */ }
    i = end + 1
  }
  return events
}

const FILE_RE = /^(.+?)-(\d+)-(\d+)-(\d{14})\.log$/

function tsFromName(tsStr) {
  // YYYYMMDDHHmmss → ms
  const iso = `${tsStr.slice(0, 4)}-${tsStr.slice(4, 6)}-${tsStr.slice(6, 8)}T${tsStr.slice(8, 10)}:${tsStr.slice(10, 12)}:${tsStr.slice(12, 14)}`
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/** 列日志文件 → [{ file, label, ts }]，按 ts 倒序（不含 events，懒加载） */
export function listLogFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.log')) continue
    const m = name.match(FILE_RE)
    let label = name.replace(/\.log$/, '')
    let ts = 0
    if (m) {
      const [, gid, uid, , tsStr] = m
      ts = tsFromName(tsStr)
      const gidLabel = gid === 'private' ? '私聊' : `群${gid}`
      const dd = `${tsStr.slice(4, 6)}-${tsStr.slice(6, 8)} ${tsStr.slice(8, 10)}:${tsStr.slice(10, 12)}`
      label = `${gidLabel} · ${uid} · ${dd}`
    }
    out.push({ file: name, label, ts })
  }
  return out.sort((a, b) => b.ts - a.ts)
}

/** 读单文件 → LogEvent[]（防路径穿越：解析后路径必须在 dir 内） */
export function readLogFile(dir, file) {
  const fp = path.resolve(dir, file)
  if (!fp.startsWith(path.resolve(dir) + path.sep) && fp !== path.resolve(dir)) return []
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return []
  return parseDevLog(fs.readFileSync(fp, 'utf8'))
}

/**
 * 聚合近 N 日 stats（供 /api/overview）：tokenTrend（按天 input/output）+ toolTop（工具计数 TopK）。
 * 仅扫文件名日期 >= since 的文件，避免全扫。
 */
export function aggregateStats(dir, { since = 0, topK = 5 } = {}) {
  const dayMap = {}
  const toolMap = {}
  for (const f of listLogFiles(dir)) {
    if (f.ts < since) continue
    for (const e of readLogFile(dir, f.file)) {
      if (!e || !e.time) continue
      const day = String(e.time).slice(5, 10) // ISO → MM-DD
      if (e.event === 'run_end' && e.usage) {
        const u = e.usage.raw || e.usage
        const din = u.input ?? u.input_tokens ?? u.prompt_tokens ?? 0
        const dout = u.output ?? u.output_tokens ?? u.completion_tokens ?? 0
        if (din || dout) (dayMap[day] ||= { input: 0, output: 0 }), (dayMap[day].input += din), (dayMap[day].output += dout)
      }
      if (e.event === 'tool' && e.name) toolMap[e.name] = (toolMap[e.name] || 0) + 1
    }
  }
  const tokenTrend = Object.entries(dayMap)
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([day, v]) => ({ day, input: v.input, output: v.output }))
  const toolTop = Object.entries(toolMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([name, count]) => ({ name, count }))
  return { tokenTrend, toolTop }
}
