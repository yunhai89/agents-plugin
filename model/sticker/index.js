/**
 * 表情包索引层（纯函数为主）。
 *
 * 职责：路径常量、文件名清洗(§5.2)、扫描 _repo(过滤黑名单)、index.json 构建/读写(合并保留旧 tags/usageCount)、
 *      catalog() 产 prompt 注入块。
 *
 * 存储布局（relpath 相对 REPO_DIR，images/ 同构镜像）：
 *   resources/stickers/_repo/<repo 全量>      ← git 浅克隆
 *   resources/stickers/images/root/<散图>     ← 根目录散图（source=root）
 *   resources/stickers/images/<目录>/<图>     ← 按人目录（source=目录名）
 *   resources/stickers/index.json             ← 清单
 */

import fs from 'node:fs'
import path from 'node:path'
import Config from '../../utils/Config.js'

const STICKER_DIR = path.join(Config.path.plugin, 'resources/stickers')
const REPO_DIR = path.join(STICKER_DIR, '_repo')
const IMAGES_DIR = path.join(STICKER_DIR, 'images')
const INDEX_PATH = path.join(STICKER_DIR, 'index.json')

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
/** 内置 NSFW 关键词兜底（用户 excludeKeywords 追加其上） */
const BUILTIN_KEYWORD_BLOCK = [/nsfw/i, /色情|裸露|porn|hentai|18禁/i]

export const paths = { STICKER_DIR, REPO_DIR, IMAGES_DIR, INDEX_PATH }

export function ensureDirs() {
  for (const d of [STICKER_DIR, REPO_DIR, IMAGES_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }) } catch { /* noop */ }
  }
}

/**
 * 文件名清洗（文档 §5.2）→ 短句名称。
 * 去扩展名 → 去《》 → 去前缀 [回复-xxx]/[截图] → 取首个 _ 之后主体 → trim → 限 20 字。
 */
export function cleanName(filename) {
  let s = path.basename(filename)
  const ext = path.extname(s)
  if (ext) s = s.slice(0, -ext.length)
  s = s.replace(/《|》/g, '')
  s = s.replace(/^\[[^\]]*\]\s*/, '')
  if (s.includes('_')) s = s.slice(s.indexOf('_') + 1)
  s = s.replace(/^[_\s]+|[_\s]+$/g, '').trim()
  if (!s) s = (ext ? path.basename(filename, ext) : path.basename(filename)) || 'sticker'
  return s.length > 20 ? s.slice(0, 20) : s
}

/**
 * 扫描 _repo 递归，按图片扩展名过滤，剔除黑名单顶层目录 + 关键词命中文件。
 * 返回 [{ relpath, name, source, abs }]，relpath 形如 'root/x.png' 或 '<目录>/x.png'。
 */
export function scanRepo({ excludeDirs = [], excludeKeywords = [] } = {}) {
  if (!fs.existsSync(REPO_DIR)) return []
  const exclDirSet = new Set(excludeDirs.map((d) => String(d).replace(/\/$/, '')))
  const kwRes = [...BUILTIN_KEYWORD_BLOCK, ...excludeKeywords.filter(Boolean).map((k) => new RegExp(k, 'i'))]
  const out = []
  const walk = (dir, topDir, dirRel) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === '_repo') continue
      const abs = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (!topDir && exclDirSet.has(ent.name)) continue // 仅拦顶层黑名单目录
        const childTop = topDir || ent.name
        const childRel = dirRel ? `${dirRel}/${ent.name}` : ent.name
        walk(abs, childTop, childRel)
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase()
        if (!IMG_EXT.has(ext)) continue
        if (kwRes.some((re) => re.test(ent.name))) continue
        const source = topDir || 'root'
        const fileRel = dirRel ? `${dirRel}/${ent.name}` : `root/${ent.name}`
        out.push({ relpath: fileRel, name: cleanName(ent.name), source, abs })
      }
    }
  }
  walk(REPO_DIR, '', '')
  return out
}

/**
 * 由扫描结果构建 stickers 映射，合并保留旧条目的 tags/usageCount/nsfw/desc（按 file=relpath 匹配）。
 * 同名名称冲突追加 _2/_3。
 */
export function buildIndex(scanned, oldIndex, { commit } = {}) {
  const oldByFile = new Map()
  for (const entry of Object.values(oldIndex?.stickers || {})) {
    oldByFile.set(entry.file, entry)
  }
  const stickers = {}
  const usedNames = new Set()
  for (const it of scanned) {
    let name = it.name
    if (usedNames.has(name)) {
      let i = 2
      while (usedNames.has(`${name}_${i}`)) i++
      name = `${name}_${i}`
    }
    usedNames.add(name)
    const old = oldByFile.get(it.relpath)
    stickers[name] = {
      file: it.relpath,
      desc: old?.desc || it.name,
      tags: old?.tags || [],
      source: it.source,
      usageCount: old?.usageCount || 0,
      nsfw: old?.nsfw || false,
    }
  }
  return { version: 3, commit: commit ?? oldIndex?.commit ?? null, updatedAt: Date.now(), stickers }
}

export function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_PATH)) return null
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'))
  } catch { return null }
}

/** 原子写盘（tmp+rename） */
export function saveIndex(index) {
  ensureDirs()
  const tmp = `${INDEX_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2))
  fs.renameSync(tmp, INDEX_PATH)
}

/** index 中某条目对应图片在 images/ 下的绝对路径 */
export function imageAbsOf(entry) {
  return path.join(IMAGES_DIR, entry.file)
}

/** 目录体积（字节，递归；不存在返回 0） */
export function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  const walk = (d) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const ent of entries) {
      const abs = path.join(d, ent.name)
      if (ent.isDirectory()) walk(abs)
      else if (ent.isFile()) try { total += fs.statSync(abs).size } catch { /* noop */ }
    }
  }
  walk(dir)
  return total
}

/**
 * 产 prompt 注入块文本（catalog）。
 * ≤ listTopN 全量列出；超 listTopN 取 usageCount 高频 listTopN 个，注明总数。
 */
export function buildCatalog(index, { listTopN = 30 } = {}) {
  const entries = index?.stickers ? Object.entries(index.stickers) : []
  if (!entries.length) return ''
  const sorted = entries.sort((a, b) => (b[1].usageCount || 0) - (a[1].usageCount || 0))
  const top = sorted.slice(0, listTopN).map(([name, e]) => {
    const tag = e.tags?.length ? e.tags.join('/') : (e.desc || name)
    return `- ${name}: ${tag}`
  })
  return [
    '## 表情包',
    '你可以在回复中插入 [sticker:名称] 附带表情包，让回复更生动拟人。',
    '可用表情（名称: 语义）：',
    ...top,
    ...(entries.length > listTopN ? [`……（共 ${entries.length} 个，仅列高频 ${listTopN}）`] : []),
    '使用规则：',
    '1. 表情包是偶尔的锦上添花——大多数回复不需要；拿不准就不用。',
    '2. 一条回复最多 2 个，插在语义贴合的位置；连续几条回复最多带一次。',
    '3. 严肃场景（故障排查/求助/投诉/用户情绪低落）不要使用。',
    '4. 只使用上面列出的名称，不要编造；标记格式严格为 [sticker:名称]。',
  ].join('\n')
}
