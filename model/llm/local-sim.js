/**
 * 纯代码文本相似度 —— 无 embedding API 时的回退方案。
 *
 * 配合 @node-rs/jieba（nodejieba 的 napi-rs 预编译版，原生 nodejieba 因 build-script
 * 被忽略装不上，用这个等价替代）做中文分词；实现：
 *   - BM25（Okapi）：query → 文档检索排序（搜索引擎标准，比 jaccard 准）
 *   - SimHash + hamming：近似文本去重（32-bit 指纹，≤3 位差视为近似）
 *   - tokenize：jieba.cut（装了）/ recall.tokenize CJK 2-gram（降级）
 *
 * jieba 懒加载（动态 import），未装/加载失败静默降级，不阻塞模块加载。
 */

// jieba 单例（懒加载；null=未决定，false=不可用，Jieba 实例=可用）
let _jieba = null
async function getJieba() {
  if (_jieba !== null) return _jieba
  try {
    const mod = await import('@node-rs/jieba')
    const Jieba = mod.Jieba || mod.default?.Jieba
    _jieba = Jieba ? new Jieba() : false
  } catch {
    _jieba = false
  }
  return _jieba
}

// 降级分词：复用 recall.tokenize（CJK 2-gram + Latin 词）
let _cjkTokenize = null
async function getCjk() {
  if (_cjkTokenize) return _cjkTokenize
  try {
    const { tokenize } = await import('../agent/recall.js')
    _cjkTokenize = tokenize
  } catch {
    _cjkTokenize = null
  }
  return _cjkTokenize
}

const STOP = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '和', '与', '或', '及', 'a', 'an', 'the', 'of', 'to', 'in', 'on', 'is', 'are'])

/** 分词：jieba.cut（装了）/ CJK 2-gram（降级）；去停用词 + 空串 */
export async function tokenize(text) {
  const t = String(text || '').toLowerCase().trim()
  if (!t) return []
  const j = await getJieba()
  let toks
  if (j) {
    toks = j.cut(t) // 默认 hmm=true；返回词/字数组
  } else {
    const cjk = await getCjk()
    toks = cjk ? [...cjk(t)] : t.split(/\s+/)
  }
  return toks.map((s) => s.trim()).filter((s) => s && !STOP.has(s))
}

/**
 * Okapi BM25 —— 批量文档检索打分。
 * 用法：const bm = new BM25(); docs.forEach(d => bm.add(await tokenize(d))); bm.score(qTokens, i)
 */
export class BM25 {
  constructor({ k1 = 1.5, b = 0.75 } = {}) {
    this.k1 = k1
    this.b = b
    this.docs = [] // [{ freq:Map, len }]
    this.df = new Map() // term -> 出现该词的文档数
    this.sumLen = 0
  }

  add(tokens) {
    const freq = new Map()
    for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1)
    this.docs.push({ freq, len: tokens.length })
    this.sumLen += tokens.length
    for (const t of freq.keys()) this.df.set(t, (this.df.get(t) || 0) + 1)
  }

  /** query tokens vs 第 idx 个文档的 BM25 分数（未归一化，可比） */
  score(queryTokens, idx) {
    const doc = this.docs[idx]
    if (!doc) return 0
    const N = this.docs.length
    const avgdl = N ? this.sumLen / N : 0
    const denom0 = this.k1 * (1 - this.b + this.b * (doc.len / (avgdl || 1)))
    let s = 0
    for (const t of queryTokens) {
      const f = doc.freq.get(t)
      if (!f) continue
      const df = this.df.get(t) || 0
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1) // Okapi IDF（+1 防负）
      s += (idf * (f * (this.k1 + 1))) / (f + denom0)
    }
    return s
  }

  /** 批量打分 → 归一化到 [0,1]（除以最大值；全 0 则全 0），适配 cosine 风格的 minScore 过滤 */
  scoresNormalized(queryTokens) {
    const raw = this.docs.map((_, i) => this.score(queryTokens, i))
    const max = Math.max(...raw, 0)
    return max > 0 ? raw.map((s) => s / max) : raw
  }
}

// ── SimHash（32-bit 局部敏感哈希，近似去重）──

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** tokens → 32-bit SimHash 指纹（词频加权） */
export function simhash(tokens) {
  const v = new Int32Array(32)
  const freq = new Map()
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1)
  for (const [t, w] of freq) {
    const h = fnv1a(t)
    for (let i = 0; i < 32; i++) v[i] += (h >> i) & 1 ? w : -w
  }
  let fp = 0
  for (let i = 0; i < 32; i++) if (v[i] > 0) fp |= (1 << i)
  return fp >>> 0
}

function popcount32(n) {
  n = n - ((n >>> 1) & 0x55555555)
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333)
  n = (n + (n >>> 4)) & 0x0f0f0f0f
  return Math.imul(n, 0x01010101) >>> 24
}

/** 两个 32-bit 指纹的 hamming 距离（不同位数） */
export function hamming(a, b) {
  return popcount32((a ^ b) >>> 0)
}

/** 近似判定：hamming ≤ threshold（默认 3，32-bit SimHash 经验值） */
export function isNearDup(a, b, threshold = 3) {
  return hamming(a, b) <= threshold
}
