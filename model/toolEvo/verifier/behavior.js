/**
 * 行为验证（阶段2，文档 §16）：对候选跑 tests + 断言 + 性能/确定性门。
 *
 * Oracle 优先级（文档 §16.1）：程序断言（expected 深比）> 默认。禁同模型自证（生成 ≠ 裁判）。
 * 一个候选通过 AST 静态门 ≠ 正确；行为验证用真实输入跑 + 断言输出。
 *
 * @returns { passed, results[], evidence:{totalTests, passed, avgMs, timedOut} }
 */
import { runCandidate } from '../sandbox.js'

/** 深比（JSON 规范化后字符串比；候选输出与 expected 须结构一致） */
function deepEqual(a, b) {
  try { return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)) }
  catch { return false }
}
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize)
  if (v && typeof v === 'object') {
    const o = {}; for (const k of Object.keys(v).sort()) o[k] = normalize(v[k]); return o
  }
  return v
}

/**
 * @param {object} p { source, tests:[{name?,input,expected?}], timeoutMs?, perfMs?（单测耗时上限） }
 */
export async function verifyBehavior({ source, tests, timeoutMs = 3000, perfMs = 5000 }) {
  const results = []
  let timedOutCount = 0
  for (const t of tests || []) {
    const r = await runCandidate({ source, input: t.input, timeoutMs })
    let passed = false, reason = ''
    if (r.timedOut) { timedOutCount++; reason = `超时(>${timeoutMs}ms)` }
    else if (!r.ok) { reason = `执行失败：${r.error || ''}${r.errorClass ? '(' + r.errorClass + ')' : ''}` }
    else if (t.expected !== undefined) {
      passed = deepEqual(r.output, t.expected)
      if (!passed) reason = `输出 ${JSON.stringify(r.output).slice(0, 80)} ≠ 期望 ${JSON.stringify(t.expected).slice(0, 80)}`
    } else {
      // 无 expected（属性测试占位，第一版视为通过 if ok）
      passed = true
    }
    // 性能门
    if (passed && r.duration > perfMs) { passed = false; reason = `性能超限：${r.duration}ms > ${perfMs}ms` }
    results.push({ name: t.name || JSON.stringify(t.input).slice(0, 40), passed, reason, duration: r.duration })
  }
  const passedCount = results.filter((r) => r.passed).length
  return {
    passed: results.length > 0 && passedCount === results.length,
    results,
    evidence: {
      totalTests: results.length,
      passed: passedCount,
      avgMs: results.length ? Math.round(results.reduce((s, r) => s + (r.duration || 0), 0) / results.length) : 0,
      timedOut: timedOutCount,
    },
  }
}

export default { verifyBehavior, deepEqual }
