/**
 * 反思式变异器（GEPA reflective mutation）—— 增强版。
 *
 * 增强点（对应文档 §7.2 GEPA 论文核心）：
 *  1. 段落级交叉（crossoverParagraph）：按 \\n\\n 切分段落交替组合，比句级更自然
 *  2. 变异温度（temperature ∈ [0,1]）：高=激进探索，低=保守精化；由 optimizer 根据种群多样性动态设定
 *  3. 语义保留突变：变异指令按温度调整——低温微调措辞，高温重构结构
 *
 * 接口（可注入 mock 用于确定性测试）：
 *   seed({ goal, baseline, n })                    → string[]
 *   mutate({ parent, evalResult, goal, temperature }) → string[]
 *   crossover(a, b) / crossoverParagraph(a, b)     → string[]
 */

import { extractJsonArray } from './dataset.js'

function variantsPrompt(instruction) {
  return [
    instruction,
    '只输出改进后的文本变体，不要解释。输出为 JSON 字符串数组（每项是一个完整的新文本）。',
  ].join('\n')
}

/**
 * 按温度构造变异指令（§7.2 反思式进化 + 自适应温度）。
 */
function mutationInstruction(parent, evalResult, goal, temperature = 0.5) {
  const failures = (evalResult?.perCase || [])
    .filter((p) => !p.passed)
    .map((p) => `- 用例 ${p.caseId}：${p.feedback || '未通过'}`)
    .join('\n')

  const tempGuide = temperature > 0.7
    ? '大胆重构：可以重组段落结构、删减冗余、改变表述方式，只要保留核心语义和约束。'
    : temperature > 0.3
      ? '适度调整：修正失败点、优化措辞，保持原有结构。'
      : '微调打磨：仅做最小改动——修正一个措辞或补充一个细节，其余不动。'

  return [
    `目标：${goal}`,
    `当前文本：\n"""\n${parent}\n"""`,
    failures ? `评估中发现的失败原因：\n${failures}\n` : '当前评估未发现明显失败，尝试优化表述。\n',
    `变异策略（温度=${temperature.toFixed(2)}）：${tempGuide}`,
    '保留原意与关键安全约束，输出一个改进后的文本变体。',
  ].join('\n')
}

export function createMutator({ agent } = {}) {
  return {
    async seed({ goal, baseline, n = 3 }) {
      if (!agent) return baseline != null ? [baseline] : []
      const instruction = [
        `目标：${goal}`,
        `当前基线文本：\n"""\n${baseline}\n"""`,
        `请基于该基线生成 ${n} 个不同的改写变体，保持原意、尝试让它更好地达成目标。`,
      ].join('\n')
      const { content } = await agent.run(variantsPrompt(instruction))
      const arr = extractJsonArray(content).map((s) => String(s))
      return arr.length ? arr : (baseline != null ? [baseline] : [])
    },

    /**
     * 反思式变异（温度自适应）。
     * @param {object} opts { parent, evalResult, goal, temperature }
     * temperature ∈ [0,1]，由 optimizer 根据种群多样性动态传入。
     */
    async mutate({ parent, evalResult, goal, temperature = 0.5 }) {
      if (!agent) return [parent]
      const instruction = mutationInstruction(parent, evalResult, goal, temperature)
      const { content } = await agent.run(variantsPrompt(instruction))
      const arr = extractJsonArray(content).map((s) => String(s)).filter((s) => s && s.trim())
      return arr.length ? arr : [parent]
    },

    /** 句级交叉（原始版本保留） */
    crossover(a, b) {
      const sa = a.split(/(?<=[。.!?\n])\s*/).filter(Boolean)
      const sb = b.split(/(?<=[。.!?\n])\s*/).filter(Boolean)
      if (!sa.length || !sb.length) return [a]
      const head = sa.slice(0, Math.ceil(sa.length / 2)).join('')
      const tail = sb.slice(Math.floor(sb.length / 2)).join('')
      return [head + tail]
    },

    /** 段落级交叉（增强版）：按 \n\n 切分，交替取段 */
    crossoverParagraph(a, b) {
      const pa = a.split(/\n\s*\n/).filter((p) => p.trim())
      const pb = b.split(/\n\s*\n/).filter((p) => p.trim())
      if (pa.length < 2 || pb.length < 2) return this.crossover(a, b) // 段落太少回退句级
      const maxLen = Math.max(pa.length, pb.length)
      const parts = []
      for (let i = 0; i < maxLen; i++) {
        // 偶数段取 a，奇数段取 b（保证覆盖双方核心段落）
        const source = i % 2 === 0 ? pa : pb
        if (source[i] != null) parts.push(source[i])
        else {
          const other = i % 2 === 0 ? pb : pa
          if (other[i] != null) parts.push(other[i])
        }
      }
      return [parts.join('\n\n')]
    },
  }
}
