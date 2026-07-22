/**
 * 自我进化引擎 —— 公共出口。
 *
 * evolve() 编排一次离线进化：读 target + dataset → GEPA 循环 → 返回 best + 报告数据。
 * 永不自动应用结果；调用方拿到 result 后经 writeReport 落盘供人工审查。
 *
 * 用法：
 *   import { evolve, writeReport } from '../../model/evolution/index.js'
 *   const result = await evolve({
 *     target: { type:'systemPrompt', name:'weather-bot', text: currentPrompt, goal:'让助手准确调用天气工具' },
 *     dataset,                                              // Case[]（programmatic/fromTraces/synthetic）
 *     agentFactory: (prompt) => new Agent({ provider, systemPrompt: prompt, tools }),
 *     judge: { score: (c, out) => llmScore(c, out) },       // 可选；有 check 的 case 免 judge
 *     iterations: 10, populationSize: 8, seed: 42,
 *     gates: { size: { maxChars: 4000 }, semantic: { minSimilarity: 0.2 }, cache: { prefixKeepRatio: 0.2 } },
 *     // mutator 可选；不传则用 createMutator({ agent }) 的 LLM 默认实现
 *   })
 *   writeReport(result, './reports/weather-bot')
 */

import { optimize } from './optimizer.js'
import { createMutator } from './mutator.js'

export async function evolve(opts = {}) {
  const {
    target,
    dataset,
    agentFactory,
    judge,
    mutator,
    agent,
    gates,
    iterations,
    populationSize,
    offspringPerIter,
    seed,
    logger,
    patience,              // ✨ 早停
    useParagraphCrossover, // ✨ 段落交叉
  } = opts

  const mut = mutator || createMutator({ agent })

  const result = await optimize({
    target,
    dataset,
    agentFactory,
    judge,
    mutator: mut,
    gates,
    iterations,
    populationSize,
    offspringPerIter,
    seed,
    logger,
    patience,
    useParagraphCrossover,
  })
  result.target = target
  return result
}

export { optimize, mulberry32, paretoFront, pickBest, dominates } from './optimizer.js'
export { evaluate, createLlmJudge, extractJsonObject } from './evaluator.js'
export { createMutator } from './mutator.js'
export {
  runGates,
  sizeGate,
  testGate,
  semanticGate,
  cacheGate,
  similarity,
  lcpRatio,
  defaultGateConfig,
} from './gates.js'
export { writeReport } from './report.js'
export { TraceStore, TraceCollector } from './trace.js'
export { makeCase, fromTraces, synthetic, extractJsonArray } from './dataset.js'
