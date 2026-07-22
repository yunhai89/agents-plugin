/**
 * 评估器：用候选文本装配 Agent，在数据集上逐 case 运行并评分，聚合为 EvalResult。
 *
 *   evaluate(candidate, dataset, { agentFactory, judge, onCase }) → EvalResult
 *   EvalResult = { candidate, score∈[0,1], length, perCase:[{caseId, score, feedback, passed}] }
 *
 * 评分优先级：case.check（程序化，零 LLM）> judge.score（LLM 评委）> 默认 0.5。
 */

function clamp01(x) {
  const n = Number(x)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function normalizeCheckResult(r) {
  if (r === true) return { score: 1, feedback: 'check passed' }
  if (r === false) return { score: 0, feedback: 'check failed' }
  if (typeof r === 'number') return { score: clamp01(r), feedback: '' }
  if (r && typeof r === 'object') {
    return { score: clamp01(r.score ?? 0.5), feedback: r.feedback || '' }
  }
  return { score: 0.5, feedback: '' }
}

/**
 * @param {string} candidate 候选文本（如 systemPrompt）
 * @param {Case[]} dataset
 * @param {object} opts { agentFactory(candidate)→{run}, judge:{score(case,output,runResult)}, onCase }
 */
export async function evaluate(candidate, dataset, { agentFactory, judge, onCase } = {}) {
  const perCase = []
  let sum = 0
  let count = 0

  for (const c of dataset) {
    count += 1
    let runResult
    try {
      const agent = agentFactory(candidate)
      runResult = await agent.run(c.input)
    } catch (e) {
      runResult = { content: '', error: e?.message || String(e), turns: 0 }
    }
    const output = runResult?.content ?? ''

    let sc
    if (typeof c.check === 'function') {
      try {
        sc = normalizeCheckResult(await c.check(output, runResult))
      } catch (e) {
        sc = { score: 0, feedback: `check threw: ${e?.message || e}` }
      }
    } else if (judge && typeof judge.score === 'function') {
      try {
        sc = normalizeCheckResult(await judge.score(c, output, runResult))
      } catch (e) {
        sc = { score: 0, feedback: `judge threw: ${e?.message || e}` }
      }
    } else {
      sc = { score: 0.5, feedback: 'no check or judge' }
    }

    const passed = sc.score >= 0.5
    perCase.push({ caseId: c.id, score: sc.score, feedback: sc.feedback, passed })
    sum += sc.score
    if (onCase) onCase(c, sc, runResult)
  }

  const score = count ? sum / count : 0
  return { candidate, score, length: (candidate || '').length, perCase }
}

/** 从文本中抠出首个 JSON 对象（容错：去 code fence、匹配首个 { 到对应 }） */
export function extractJsonObject(text) {
  if (!text) return null
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = s.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * 构造一个基于 LLM（Agent）的评委：让模型对 Agent 回复打分（0~1）并给出一句反馈。
 * 用于没有 programmatic check 的 case。
 */
export function createLlmJudge(agent) {
  return {
    async score(case_, output /*, runResult */) {
      if (!agent) return { score: 0.5, feedback: 'no judge agent' }
      const inputStr = typeof case_.input === 'string' ? case_.input : JSON.stringify(case_.input)
      const prompt = [
        '你是严格的评估评委。给下面 AI Agent 的回复打分（0.0~1.0，越高越好），并用一句话指出不足。',
        `任务输入：${inputStr}`,
        case_.expected ? `期望：${case_.expected}` : '',
        `Agent 回复：\n"""\n${output}\n"""`,
        '只输出 JSON：{"score":0.0,"feedback":"一句话反馈"}',
      ]
        .filter(Boolean)
        .join('\n')
      const { content } = await agent.run(prompt)
      const obj = extractJsonObject(content)
      return { score: clamp01(obj?.score ?? 0.5), feedback: obj?.feedback || '' }
    },
  }
}
