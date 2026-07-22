/**
 * 评估数据集 —— Case 类型与三种来源（programmatic / fromTraces / synthetic）。
 *
 * Case = { id, input, expected?, check?, context? }
 *   check(output, runResult) => true | false | number∈[0,1] | { score, feedback }
 */

let _seq = 0
function autoId(prefix = 'case') {
  _seq += 1
  return `${prefix}-${_seq}`
}

export function makeCase(obj) {
  return {
    id: obj.id || autoId(),
    input: obj.input,
    ...(obj.expected != null ? { expected: obj.expected } : {}),
    ...(typeof obj.check === 'function' ? { check: obj.check } : {}),
    ...(obj.context != null ? { context: obj.context } : {}),
  }
}

/** 从轨迹列表构造 Cases（input 取自轨迹；若轨迹带 expected/check 则带上） */
export function fromTraces(traces, { prefix = 'trace' } = {}) {
  if (!Array.isArray(traces)) return []
  return traces
    .filter((t) => t && t.input != null)
    .map((t, i) => {
      const c = {
        id: `${prefix}-${t.taskId || i}`,
        input: t.input,
        context: { trace: t },
      }
      if (t.expected != null) c.expected = t.expected
      if (typeof t.check === 'function') c.check = t.check
      return c
    })
}

/**
 * 用 LLM 生成 n 个测试输入（对应 --eval-source synthetic）。
 * @param {object} opts { goal, n, agent }  agent 为用于生成的 Agent（经 provider）
 */
export async function synthetic({ goal, n = 5, agent }) {
  if (!agent) throw new Error('synthetic 需要 agent（用于生成用例）')
  const prompt = [
    `为下面的目标生成 ${n} 个用于评估 AI Agent 的测试输入。`,
    '每条是一个真实用户请求（不要解释、不要编号），整体输出为严格的 JSON 字符串数组。',
    `目标：${goal}`,
  ].join('\n')
  const { content } = await agent.run(prompt)
  const arr = extractJsonArray(content)
  return arr
    .filter((x) => x != null)
    .map((input, i) => makeCase({ id: `syn-${i}`, input: String(input) }))
}

/** 从模型回复里抠出 JSON 数组（容错：去 code fence、找首个 [ 到对应 ]） */
export function extractJsonArray(text) {
  if (!text) return []
  let s = text.trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = s.indexOf('[')
  if (start === -1) return []
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
    else if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) {
        const slice = s.slice(start, i + 1)
        try {
          const arr = JSON.parse(slice)
          return Array.isArray(arr) ? arr : []
        } catch {
          return []
        }
      }
    }
  }
  return []
}
