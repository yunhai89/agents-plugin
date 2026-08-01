/**
 * 候选工具生成器（文档 §13）。
 *
 * 用 LLM + response_format json_schema 产出结构化 { manifest, source, tests, assumptions }。
 * 约束：① sideEffects ∈ {none, read}（isGenerationAllowed，固定受信适配器永不自动生成）
 *      ② 纯函数 JS：export async function run(input, ctx)，零 import（verifyStatic 兜底）
 * 修复循环：输出不合规则带错误重新生成，≤ maxRepairAttempts（防无限自我修复把安全限制"修掉"）。
 *
 * provider/model 由 apps 注入（如 SelfReviewer）；库零依赖。
 */
import { validateManifest, isGenerationAllowed, makeManifest } from './manifest.js'

/** 候选输出 JSON Schema（严格，供 response_format） */
const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['manifest', 'source', 'tests'],
  properties: {
    manifest: {
      type: 'object',
      required: ['name', 'description', 'inputSchema', 'permissions'],
      properties: {
        name: { type: 'string', pattern: '^[a-z][a-z0-9_-]*$' },
        description: { type: 'string', minLength: 6 },
        category: { type: 'string', enum: ['query', 'personal', 'message', 'group_manage', 'system'] },
        useWhen: { type: 'array', items: { type: 'string' } },
        doNotUseWhen: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', items: { type: 'string' } },
        inputSchema: { type: 'object' },
        permissions: {
          type: 'object',
          required: ['sideEffects'],
          properties: {
            sideEffects: { type: 'array', items: { enum: ['none', 'read'] }, minItems: 1 },
          },
        },
      },
    },
    source: { type: 'string', description: '纯函数 JS：export async function run(input, ctx) { ... }，零 import' },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        required: ['input', 'expected'],
        properties: { name: { type: 'string' }, input: {}, expected: {} },
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
}

/** 构造生成 prompt（单一原子职责/完整 schema/禁 API/资源/副作用/测试/输出 JSON） */
function buildPrompt({ goal, examples, context }) {
  return [
    '你在为一个 Node.js Agent 生成一个【可复用工具】。输出必须是严格 JSON，schema 见 response_format。',
    '',
    '## 任务目标（能力缺口）',
    goal,
    context ? `\n## 情境\n${context}` : '',
    '',
    '## 硬性约束（违反即拒绝）',
    '1. 单一原子职责；纯函数，零副作用优先（sideEffects: ["none"]），只读 ["read"] 次之；',
    '   禁止 write/network/message/delete（这些走固定受信适配器，永不自动生成）。',
    '2. source 必须是 `export async function run(input, ctx) { ... return result }`，零 import（不引任何模块）。',
    '   禁 require/child_process/process.env/eval/动态 import/new Function。',
    '3. inputSchema 用 JSON Schema 描述入参；tests 至少 2 个（含 1 个边界/错误用例）。',
    '4. name 小写字母+数字+连字符/下划线；description ≥6 字符说清用途与适用条件。',
    '5. manifest.category 填权限类别：纯计算/只读 "query"（人人可用，多数工具为此）；用户私有数据 "personal"；'
      + '发消息 "message"；群管写操作 "group_manage"；系统级 "system"。',
    examples?.length ? `\n## 参考用例\n${examples.map((e) => `- 输入:${JSON.stringify(e.input)} → 期望:${JSON.stringify(e.expected)}`).join('\n')}` : '',
    '',
    '## 输出',
    '严格按 response_format 的 JSON schema 输出，不要任何额外文字。',
  ].filter(Boolean).join('\n')
}

export class ToolSynthesizer {
  constructor({ provider, model, maxRepairAttempts = 2, logger = () => {} }) {
    this.provider = provider
    this.model = model
    this.maxRepairAttempts = Math.max(0, Number(maxRepairAttempts) || 0)
    this.logger = logger
  }

  /**
   * 生成一个候选工具。
   * @returns { ok, candidate?:{manifest,source,tests,assumptions}, error? }
   */
  async generate({ goal, examples = [], context = '' }) {
    const prompt = buildPrompt({ goal, examples, context })
    let lastError = null
    for (let attempt = 0; attempt <= this.maxRepairAttempts; attempt++) {
      let raw
      try {
        raw = await this._call(prompt, lastError)
      } catch (e) {
        lastError = `LLM 调用失败：${e?.message || e}`
        this.logger('warn', '[toolEvo:synth] LLM 调用失败', lastError)
        continue
      }
      const parsed = this._parse(raw)
      if (!parsed.ok) { lastError = `输出非合法 JSON：${parsed.error}`; continue }
      const cand = parsed.value
      const chk = this._validateCandidate(cand)
      if (!chk.ok) { lastError = chk.error; this.logger('debug', '[toolEvo:synth] 候选不合规，修复重试', chk.error); continue }
      return { ok: true, candidate: cand }
    }
    return { ok: false, error: lastError || `生成失败（超过 ${this.maxRepairAttempts} 次修复）` }
  }

  /** 本地校验候选（manifest + 生成闸 + 导出 run）—— AST/沙箱留给 verifier */
  _validateCandidate(cand) {
    if (!cand || typeof cand !== 'object') return { ok: false, error: '输出非对象' }
    if (!cand.manifest) return { ok: false, error: '缺 manifest' }
    // LLM 不产 version/status/runtime/provenance（系统决定）—— makeManifest 补默认，强制 draft
    cand.manifest = makeManifest({ ...cand.manifest, status: 'draft' })
    const mv = validateManifest(cand.manifest)
    if (!mv.ok) return { ok: false, error: 'manifest：' + mv.errors.join('; ') }
    if (!isGenerationAllowed(cand.manifest)) return { ok: false, error: '生成闸：仅允许 sideEffects none/read' }
    if (!cand.source || !/export\s+async\s+function\s+run\s*\(/.test(cand.source)) return { ok: false, error: 'source 须为 export async function run(...)' }
    if (!Array.isArray(cand.tests) || cand.tests.length < 1) return { ok: false, error: 'tests 至少 1 个' }
    return { ok: true }
  }

  async _call(prompt, repairHint) {
    const content = repairHint ? `${prompt}\n\n—— 上次输出被拒：${repairHint}\n请修正后严格按 schema 重新输出。` : prompt
    const r = await this.provider.chat({
      model: this.model,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: { name: 'tool_candidate', strict: true, schema: CANDIDATE_SCHEMA } },
    })
    return r?.content || ''
  }

  _parse(text) {
    try { return { ok: true, value: JSON.parse(String(text || '').trim()) } }
    catch (e) { return { ok: false, error: e?.message || String(e) } }
  }
}

export default ToolSynthesizer
