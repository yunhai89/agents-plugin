/**
 * 报告产物：把进化结果写为 reports/<name>/{evolved.md, report.md, state.json}。
 * 永不自动应用 evolved.md —— 它是供人工审查的采纳单元（对应 hermes「PR 必须人类审查」）。
 */

import fs from 'node:fs'
import path from 'node:path'

export function writeReport(result, dir) {
  fs.mkdirSync(dir, { recursive: true })
  const { best, baseline, history, pareto, improved } = result

  // evolved.md —— 进化后的文本
  const evolvedMd = path.join(dir, 'evolved.md')
  fs.writeFileSync(evolvedMd, `${best?.text ?? ''}\n`)

  // state.json —— 完整状态（可续跑）
  const stateJson = path.join(dir, 'state.json')
  fs.writeFileSync(
    stateJson,
    JSON.stringify(
      {
        target: result.target || null,
        baseline,
        best: best ? { text: best.text, score: best.score, length: best.length } : null,
        pareto,
        history,
        improved,
        iterations: result.iterations,
        seed: result.seed,
      },
      null,
      2,
    ),
  )

  // report.md —— 摘要
  const lines = []
  lines.push('# Evolution Report')
  lines.push('')
  lines.push(`- improved: ${improved ? 'yes' : 'no'}`)
  lines.push(`- iterations: ${result.iterations}  | seed: ${result.seed}`)
  lines.push(`- baseline: score ${baseline.score.toFixed(4)} / length ${baseline.length}`)
  lines.push(`- best:     score ${(best?.score ?? 0).toFixed(4)} / length ${best?.length ?? 0}`)
  lines.push(`- pareto front size: ${pareto.length}`)
  lines.push('')
  lines.push('## Score history')
  lines.push('')
  lines.push('| iter | best score | length | pareto | pop |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const h of history) {
    lines.push(`| ${h.iteration} | ${h.bestScore.toFixed(4)} | ${h.bestLength} | ${h.paretoSize} | ${h.population} |`)
  }
  lines.push('')
  lines.push('## Pareto front')
  lines.push('')
  lines.push('| score | length |')
  lines.push('| --- | --- |')
  for (const p of pareto) lines.push(`| ${p.score.toFixed(4)} | ${p.length} |`)
  lines.push('')
  const reportMd = path.join(dir, 'report.md')
  fs.writeFileSync(reportMd, lines.join('\n') + '\n')

  return { dir, evolvedMd, reportMd, stateJson }
}
