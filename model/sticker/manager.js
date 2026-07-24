/**
 * StickerManager —— 表情包门面（有状态）。
 *
 * 职责：
 *  - 资源管理：install(git clone) / update(fetch+reset) / syncImages(_repo→images+重建清单) / status / setEnable / 目录子集
 *  - prompt 注入：catalog()（仅启用且有清单时返回文本，否则空串——零影响）
 *  - 发送层双模式：renderForImage（标记→<img base64>，图片模式内嵌）/ renderForText（→segment 数组，文本模式混排）
 *  - 多层频率闸：合法性 + 数量 + 冷却 + 防连发 + 概率(sendRate)
 *  - usageCount 节流写盘
 *
 * 设计要点：
 *  - cfg 经 getter 实时读 Config（热加载后即生效）；路径静态（Config.path.plugin）。
 *  - 未启用/无资源 → _decide 返回空 acceptMap → renderFor* 仅剥除字面标记、不解析成图（零副作用，标记绝不漏给用户）。
 */

import fs from 'node:fs'
import path from 'node:path'
import Config from '../../utils/Config.js'
import { runShell } from '../terminal/index.js'
import {
  paths, ensureDirs, scanRepo, buildIndex, loadIndex, saveIndex, imageAbsOf, dirSize, buildCatalog,
} from './index.js'
import { parseMarkers, composeString, composeSegments } from './parser.js'

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const IMG_EXT = new Set(Object.keys(MIME))

function shellQuote(s) { return `"${String(s).replace(/"/g, '\\"')}"` }

export class StickerManager {
  constructor({ logger = () => {} } = {}) {
    this.logger = logger
    this._indexCache = null
    this._cooldown = new Map()   // 会话 key -> 上次带图时间戳
    this._lastHad = new Map()    // 会话 key -> 上一条回复是否带了图
    this._usageDirty = new Set()
    this._usageTimer = null
  }

  /** 实时读 sticker 配置（热加载后即生效） */
  get cfg() { return Config.get().agent?.sticker || {} }

  /** 三重门：enable && index 存在 && 条目 > 0 */
  enabled() {
    const c = this.cfg
    if (!c || c.enable !== true) return false
    const idx = this.getIndex()
    return !!(idx?.stickers && Object.keys(idx.stickers).length > 0)
  }

  getIndex() {
    if (this._indexCache === null) this._indexCache = loadIndex()
    return this._indexCache
  }

  /** prompt 注入块；未启用/无清单返回空串 */
  catalog() {
    if (!this.enabled()) return ''
    return buildCatalog(this.getIndex(), { listTopN: this.cfg.listTopN ?? 30 })
  }

  // ───────────────────────── 发送层：双模式渲染 ─────────────────────────

  /** 会话 key：群按 groupId，私聊按 pm:userId */
  _key(ctx) { return ctx?.isGroup ? (ctx.groupId || 'group') : ('pm:' + (ctx?.userId || 'anon')) }

  /**
   * 多层频率闸 → acceptMap(name → 图片绝对路径)。空 map 表示本轮不带图（标记全剥除）。
   * 顺序：启用检查 → groupOnly → 冷却 → 防连发 → 概率 → 合法性+数量。
   */
  _decide(content, ctx) {
    const acceptMap = new Map()
    if (!this.enabled()) return acceptMap
    const c = this.cfg
    if (c.groupOnly && !ctx?.isGroup) return acceptMap
    const key = this._key(ctx)
    if ((c.cooldown ?? 0) > 0) {
      const last = this._cooldown.get(key) || 0
      if (Date.now() - last < (c.cooldown | 0) * 1000) return acceptMap
    }
    if (c.antiConsecutive !== false && this._lastHad.get(key)) return acceptMap
    const rate = Math.min(1, Math.max(0, Number(c.sendRate) ?? 1))
    if (rate < 1 && Math.random() > rate) return acceptMap
    const stickers = this.getIndex()?.stickers || {}
    const max = Math.max(0, (c.maxPerReply | 0) || 0)
    let count = 0
    for (const mk of parseMarkers(content)) {
      if (max > 0 && count >= max) break
      const entry = stickers[mk.name]
      if (!entry || entry.nsfw) continue
      const abs = imageAbsOf(entry)
      if (!fs.existsSync(abs)) continue
      if (acceptMap.has(mk.name)) continue
      acceptMap.set(mk.name, abs)
      count++
    }
    return acceptMap
  }

  /** 门控副作用：更新冷却/防连发/usage。acceptMap 为空则记"本轮未带图"。 */
  _afterDecide(key, acceptMap) {
    const had = acceptMap.size > 0
    this._lastHad.set(key, had)
    if (had) {
      this._cooldown.set(key, Date.now())
      this.bumpUsage([...acceptMap.keys()])
    }
  }

  /** 本轮一次性门控（含副作用：冷却/防连发/usage）。返回 acceptMap（空=本轮不带图）。回复出口调一次，按实际发送路径 apply。 */
  decide(content, ctx) {
    const acceptMap = this._decide(content, ctx)
    this._afterDecide(this._key(ctx), acceptMap)
    return acceptMap
  }

  /** 图片模式应用：把通过的标记替换为 <img class="sticker" src="data:...">，未通过的剥除 → 返回 content 字符串 */
  applyImage(content, acceptMap) {
    return composeString(content, acceptMap || new Map(), (abs) => this._imgDataUri(abs))
  }

  /** 文本模式应用：无通过标记→干净文本字符串；有→返回 [文本段, segment.image, …] 数组 */
  applyText(content, acceptMap) {
    if (!acceptMap || acceptMap.size === 0) return composeString(content, acceptMap || new Map(), () => '')
    const seg = (typeof segment !== 'undefined' && segment) || null
    const makeImage = seg ? (abs) => seg.image(abs) : (abs) => `[图片:${path.basename(abs)}]`
    const { segs } = composeSegments(content, acceptMap, makeImage)
    return segs
  }

  /** 便捷封装：decide + applyImage（单次调用场景；注意图片失败落文本时勿重复调，改用 decide+apply 各一次） */
  renderForImage(content, ctx) { return this.applyImage(content, this.decide(content, ctx)) }
  /** 便捷封装：decide + applyText */
  renderForText(content, ctx) { return this.applyText(content, this.decide(content, ctx)) }

  _imgDataUri(abs) {
    try {
      const buf = fs.readFileSync(abs)
      const mime = MIME[path.extname(abs).toLowerCase()] || 'image/png'
      return `<img class="sticker" src="data:${mime};base64,${buf.toString('base64')}">`
    } catch { return '' }
  }

  // ───────────────────────── usage 节流写盘 ─────────────────────────

  bumpUsage(names) {
    if (!names?.length) return
    for (const n of names) this._usageDirty.add(n)
    if (this._usageTimer) return
    this._usageTimer = setTimeout(() => this._flushUsage(), 60000)
    if (this._usageTimer.unref) this._usageTimer.unref()
  }

  _flushUsage() {
    this._usageTimer = null
    const dirty = this._usageDirty
    this._usageDirty = new Set()
    if (!dirty.size) return
    const idx = this.getIndex()
    if (!idx?.stickers) return
    let changed = false
    for (const n of dirty) {
      if (idx.stickers[n]) { idx.stickers[n].usageCount = (idx.stickers[n].usageCount || 0) + 1; changed = true }
    }
    if (!changed) return
    idx.updatedAt = Date.now()
    try { saveIndex(idx); this._indexCache = idx } catch (e) { this.logger('warn', '[sticker] usage 写盘失败', e?.message || e) }
  }

  // ───────────────────────── 资源管理 ─────────────────────────

  async _headSha() {
    const r = await runShell('git rev-parse HEAD', { cwd: paths.REPO_DIR, timeout: 15 })
    return r.ok ? r.stdout.trim() : null
  }
  async _defaultBranch() {
    const r = await runShell('git rev-parse --abbrev-ref HEAD', { cwd: paths.REPO_DIR, timeout: 15 })
    const b = r.ok ? r.stdout.trim() : ''
    return b || 'HEAD'
  }

  _withHeartbeat(task, onProgress) {
    if (typeof onProgress !== 'function') return task
    const t0 = Date.now()
    const iv = setInterval(() => { try { onProgress({ elapsed: Math.round((Date.now() - t0) / 1000) }) } catch { /* noop */ } }, 15000)
    return task.finally(() => clearInterval(iv))
  }

  /** 安装：git 浅克隆 → 启用层同步 → 重建清单 */
  async install({ onProgress } = {}) {
    ensureDirs()
    if (fs.existsSync(path.join(paths.REPO_DIR, '.git'))) {
      return { ok: false, already: true, msg: '_repo 已存在。如需拉取最新请用 #表情包更新；如需重装请先删除 _repo 目录。' }
    }
    const gitCheck = await runShell('git --version', { timeout: 10 })
    if (!gitCheck.ok) return { ok: false, msg: '系统未安装 git，无法克隆表情包仓库。请先安装 git 后重试。' }
    const repo = this.cfg.repo || 'https://github.com/Mxmilu666/bangbang93HUB.git'
    const target = shellQuote(paths.REPO_DIR)
    const buildCmd = (proxy) => `git ${proxy ? `-c http.proxy=${shellQuote(proxy)} ` : ''}clone --depth 1 ${shellQuote(repo)} ${target}`
    let res = await this._withHeartbeat(runShell(buildCmd(false), { cwd: paths.STICKER_DIR, timeout: 600 }), onProgress)
    if (!res.ok && this.cfg.gitProxy) {
      res = await this._withHeartbeat(runShell(buildCmd(this.cfg.gitProxy), { cwd: paths.STICKER_DIR, timeout: 600 }), onProgress)
    }
    if (!res.ok || !fs.existsSync(path.join(paths.REPO_DIR, '.git'))) {
      return { ok: false, msg: `克隆失败：${res.stderr || res.stdout || res.signal || '未知错误'}\n出路：① 配置 sticker.gitProxy 后重试；② 手动 git clone 仓库到 ${paths.REPO_DIR} 后发 #表情包更新。` }
    }
    const commit = await this._headSha()
    const stats = await this.syncImages({ commit })
    return { ok: true, commit, stats, msg: `安装成功，共 ${stats.total} 个表情（新增 ${stats.added}）。` }
  }

  /** 更新：fetch+reset；HEAD 未变短路；变则启用层同步 + 重建清单 */
  async update({ onProgress } = {}) {
    if (!fs.existsSync(path.join(paths.REPO_DIR, '.git'))) {
      return { ok: false, msg: '尚未安装表情包资源，请先 #表情包安装。' }
    }
    const branch = await this._defaultBranch()
    const before = await this._headSha()
    const fetchCmd = (proxy) => `git ${proxy ? `-c http.proxy=${shellQuote(proxy)} ` : ''}fetch --depth 1 origin ${shellQuote(branch)}`
    let res = await this._withHeartbeat(runShell(fetchCmd(false), { cwd: paths.REPO_DIR, timeout: 600 }), onProgress)
    if (!res.ok && this.cfg.gitProxy) {
      res = await this._withHeartbeat(runShell(fetchCmd(this.cfg.gitProxy), { cwd: paths.REPO_DIR, timeout: 600 }), onProgress)
    }
    if (!res.ok) return { ok: false, msg: `更新失败：${res.stderr || res.stdout || '未知错误'}（可配置 sticker.gitProxy 重试）` }
    await runShell('git reset --hard FETCH_HEAD', { cwd: paths.REPO_DIR, timeout: 120 })
    const after = await this._headSha()
    if (before && after && before === after) return { ok: true, noop: true, msg: '已是最新，无需更新。' }
    const stats = await this.syncImages({ commit: after })
    return { ok: true, stats, msg: `更新完成：新增 ${stats.added} / 更新 ${stats.updated} / 移除 ${stats.removed}，共 ${stats.total} 个。` }
  }

  /**
   * 启用层同步：扫描 _repo（按黑名单过滤）→ 与 images/ 比对（增/改/删）→ 重建 index.json（合并保留旧 tags/usageCount）。
   * 返回 { total, added, updated, removed }。
   */
  async syncImages({ commit } = {}) {
    ensureDirs()
    const scanned = scanRepo({ excludeDirs: this.cfg.excludeDirs, excludeKeywords: this.cfg.excludeKeywords })
    const wantRel = new Set(scanned.map((s) => s.relpath))
    let added = 0, updated = 0, removed = 0

    // 删除 images/ 中多余文件（上游删除 / 刚加入黑名单的目录）
    const prune = (dir) => {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const ent of entries) {
        const abs = path.join(dir, ent.name)
        if (ent.isDirectory()) { prune(abs); try { if (!fs.readdirSync(abs).length) fs.rmdirSync(abs) } catch { /* noop */ } }
        else if (ent.isFile()) {
          const rel = path.relative(paths.IMAGES_DIR, abs).split(path.sep).join('/')
          if (!wantRel.has(rel)) { try { fs.unlinkSync(abs); removed++ } catch { /* noop */ } }
        }
      }
    }
    prune(paths.IMAGES_DIR)

    // 复制/覆盖
    const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst) }
    for (const s of scanned) {
      const dst = path.join(paths.IMAGES_DIR, s.relpath)
      let needCopy = false
      try {
        if (!fs.existsSync(dst)) needCopy = true
        else {
          const a = fs.statSync(s.abs), b = fs.statSync(dst)
          if (a.size !== b.size || Math.abs(a.mtimeMs - b.mtimeMs) > 1000) needCopy = true
        }
      } catch { needCopy = true }
      if (!needCopy) continue
      const existed = fs.existsSync(dst)
      try { copy(s.abs, dst); existed ? updated++ : added++ } catch (e) { this.logger('warn', '[sticker] 复制失败', s.relpath, e?.message || e) }
    }

    // 重建清单（合并旧）
    const oldIndex = loadIndex()
    const index = buildIndex(scanned, oldIndex, { commit: commit ?? await this._headSha() })
    saveIndex(index)
    this._indexCache = index
    return { total: scanned.length, added, updated, removed }
  }

  status() {
    const idx = this.getIndex()
    const total = idx?.stickers ? Object.keys(idx.stickers).length : 0
    const size = dirSize(paths.IMAGES_DIR)
    const top = idx?.stickers
      ? Object.entries(idx.stickers).sort((a, b) => (b[1].usageCount || 0) - (a[1].usageCount || 0)).slice(0, 5).map(([n, e]) => `${n}(${e.usageCount || 0})`).join('、') || '无'
      : '无'
    return [
      `状态：${this.cfg.enable ? '✅已开启' : '❌未开启（#表情包开启）'}`,
      `表情总数：${total}`,
      `本地体积：${(size / 1024 / 1024).toFixed(1)} MB`,
      `上游 commit：${idx?.commit || '未知'}`,
      `最近重建：${idx?.updatedAt ? new Date(idx.updatedAt).toLocaleString('zh-CN') : '未知'}`,
      `高频 Top5：${top}`,
    ].join('\n')
  }

  /** 热开关：写配置（持久化 + 触发热加载） */
  setEnable(v) {
    const cfg = Config.get()
    cfg.agent = cfg.agent || {}; cfg.agent.sticker = cfg.agent.sticker || {}
    cfg.agent.sticker.enable = !!v
    Config.save(cfg)
    return cfg.agent.sticker.enable
  }

  /** 列出 _repo 顶层目录及启停状态（基于 excludeDirs） */
  dirList() {
    if (!fs.existsSync(paths.REPO_DIR)) return '尚未安装表情包资源，请先 #表情包安装。'
    const excl = new Set((this.cfg.excludeDirs || []).map((d) => String(d).replace(/\/$/, '')))
    const entries = fs.readdirSync(paths.REPO_DIR, { withFileTypes: true }).filter((d) => !d.name.startsWith('.') && d.name !== '_repo')
    const dirs = entries.filter((d) => d.isDirectory()).map((d) => d.name).sort()
    const rootImgs = entries.filter((d) => d.isFile() && IMG_EXT.has(path.extname(d.name).toLowerCase())).length
    const lines = dirs.map((d) => `${excl.has(d) ? '⏸️' : '✅'} ${d}`)
    if (rootImgs) lines.push(`${excl.has('root') ? '⏸️' : '✅'} root（散图 ${rootImgs}）`)
    return `表情包目录（✅启用 / ⏸️停用）：\n${lines.join('\n')}\n\n用法：#表情包目录 启用 <目录名> / #表情包目录 停用 <目录名>`
  }

  /** 启用/停用某目录：改 excludeDirs + 存配置 + 重新同步 */
  async dirToggle(dir, enable) {
    if (!dir) return { ok: false, msg: '请指定目录名（见 #表情包目录）' }
    const cfg = Config.get()
    cfg.agent = cfg.agent || {}; cfg.agent.sticker = cfg.agent.sticker || {}
    const list = new Set((cfg.agent.sticker.excludeDirs || []).map((d) => String(d).replace(/\/$/, '')))
    if (enable) list.delete(dir); else list.add(dir)
    cfg.agent.sticker.excludeDirs = [...list]
    Config.save(cfg)
    const stats = await this.syncImages()
    return { ok: true, enable, dir, stats, msg: `${enable ? '启用' : '停用'} ${dir}，已重建清单（共 ${stats.total} 个）。` }
  }
}

/** 进程级单例：buildRuntime 与 apps/sticker.js 共享，保证 usageCount/冷却状态全局一致 */
let _mgr = null
export function getStickerManager(opts) {
  if (!_mgr) _mgr = new StickerManager(opts || {})
  return _mgr
}
