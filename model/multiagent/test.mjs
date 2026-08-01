/**
 * 离线自检 —— mock provider 驱动 Multi-Agent 全流程。
 * 运行：node model/multiagent/test.mjs
 */
import {
  Orchestrator,
  SubagentSpec,
  pipeline,
  parallel,
  router,
  evaluatorOptimizer,
  Semaphore,
  Trace,
  SharedState,
} from './index.js'

let passed = 0
let failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
function eq(a, b, m) { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, `${m}${s ? '' : `  (got ${JSON.stringify(a)})`}`) }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e); console.error(e?.stack) } }
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function mockProvider(responses) {
  let i = 0
  const calls = { count: 0 }
  return {
    calls,
    async chat(opts) {
      calls.count++
      const r = responses[Math.min(i, responses.length - 1)]
      i++
      return { role: 'assistant', content: r.content ?? '', toolCalls: r.toolCalls || [], reasoning: null, finishReason: r.finishReason || 'stop', usage: null, rawMessage: {} }
    },
  }
}

// ---------- 1. SubagentSpec.runTask ----------
await test('SubagentSpec：隔离上下文 + 压缩返回', async () => {
  const sp = mockProvider([{ content: '研究结果：趋势向上', finishReason: 'stop' }])
  const spec = new SubagentSpec({ name: 'tester', description: '测试', provider: sp, model: 'cheap', maxTurns: 3 })
  const result = await spec.runTask('分析趋势')
  eq(result, '研究结果：趋势向上', '返回 content')
  eq(sp.calls.count, 1, '底层 provider 调用 1 次')
})

// ---------- 2. Orchestrator 端到端（单委派 + 综合） ----------
await test('Orchestrator：分解→委派→综合（trace 验证）', async () => {
  const subProv = mockProvider([{ content: '子代理发现了重要信息', finishReason: 'stop' }])
  const researcher = new SubagentSpec({ name: 'researcher', description: '研究', provider: subProv, model: 'cheap', maxTurns: 3 })

  const orchProv = mockProvider([
    { toolCalls: [{ id: 'd1', name: 'delegate__researcher', arguments: { task: '研究 AI Agent 趋势' } }], finishReason: 'tool_calls' },
    { content: '综合报告：基于研究结果', finishReason: 'stop' },
  ])
  const orch = new Orchestrator({ provider: orchProv, model: 'flagship', subagents: [researcher], maxTurns: 5, maxConcurrent: 2 })

  const result = await orch.run('深度研究 AI Agent')
  eq(result.content, '综合报告：基于研究结果', '最终综合')
  eq(orch.trace.filter('delegate:start').length, 1, 'trace: 1 个 delegate:start')
  eq(orch.trace.filter('delegate:end').length, 1, 'trace: 1 个 delegate:end')
  eq(subProv.calls.count, 1, '子代理调用 1 次')
  eq(orchProv.calls.count, 3, 'orchestrator 调用 3 次（委派+综合+reflect 自检；Agent 默认 reflect=auto，用了 delegate 工具触发交付前自检）')
})

// ---------- 3. Orchestrator 并行委派 ----------
await test('Orchestrator：并行委派 2 个子代理', async () => {
  const subProv = mockProvider([{ content: '结果', finishReason: 'stop' }])
  const r1 = new SubagentSpec({ name: 'r1', provider: subProv, model: 't' })
  const r2 = new SubagentSpec({ name: 'r2', provider: subProv, model: 't' })

  const orchProv = mockProvider([
    { toolCalls: [
      { id: 'd1', name: 'delegate__r1', arguments: { task: '任务1' } },
      { id: 'd2', name: 'delegate__r2', arguments: { task: '任务2' } },
    ], finishReason: 'tool_calls' },
    { content: '综合', finishReason: 'stop' },
  ])
  const orch = new Orchestrator({ provider: orchProv, subagents: [r1, r2], maxTurns: 5, maxConcurrent: 2 })
  await orch.run('并行研究')
  eq(orch.trace.filter('delegate:start').length, 2, '2 个 delegate:start（并行）')
  eq(subProv.calls.count, 2, '子代理共调用 2 次')
})

// ---------- 4. Pipeline ----------
await test('pipeline：顺序链 + 链式传递', async () => {
  const pipe = pipeline([
    (input) => `s1(${input})`,
    (input) => `s2(${input})`,
    (input) => `s3(${input})`,
  ])
  eq(await pipe.run('hello'), 's3(s2(s1(hello)))', '链式传递')
})

// ---------- 5. Parallel + aggregate ----------
await test('parallel：扇出 + 聚合', async () => {
  const par = parallel(
    [(input) => `A(${input})`, (input) => `B(${input})`, (input) => `C(${input})`],
    { aggregate: (results) => results.join('|') },
  )
  eq(await par.run('x'), 'A(x)|B(x)|C(x)', '聚合')
})

// ---------- 6. Router ----------
await test('router：分类 + 兜底', async () => {
  const rt = router({
    classify: (input) => (input.includes('退款') ? 'refund' : 'other'),
    routes: { refund: (input) => `退款:${input}` },
    default: (input) => `通用:${input}`,
  })
  eq(await rt.run('我要退款'), '退款:我要退款', '命中 refund')
  eq(await rt.run('你好'), '通用:你好', '兜底')
})

// ---------- 7. Evaluator-Optimizer ----------
await test('evaluatorOptimizer：生成→评估→重生成→达标', async () => {
  let genCount = 0
  const eo = evaluatorOptimizer({
    generator: (input) => {
      genCount++
      if (typeof input === 'string') return '草稿'
      return `修订(${input.feedback})`
    },
    evaluator: ({ draft }) => (draft.includes('修订') ? { score: 0.9, feedback: '' } : { score: 0.3, feedback: '不够好' }),
    maxIterations: 3,
    threshold: 0.8,
  })
  const result = await eo.run('写报告')
  eq(result, '修订(不够好)', '重生成后达标')
  eq(genCount, 2, 'generator 调用 2 次（初始+重生成）')
})

// ---------- 8. Semaphore ----------
await test('Semaphore：并发限制', async () => {
  const sem = new Semaphore(1)
  let active = 0
  let maxActive = 0
  const task = async () => {
    await sem.acquire()
    active++
    maxActive = Math.max(maxActive, active)
    await delay(10)
    active--
    sem.release()
  }
  await Promise.all([task(), task(), task()])
  eq(maxActive, 1, '最大并发 1')
  eq(sem.active, 0, '全部释放后 active=0')
})

// ---------- 9. Trace + SharedState ----------
await test('Trace + SharedState', async () => {
  const t = new Trace()
  t.emit('x', { a: 1 })
  t.emit('y', { b: 2 })
  t.emit('x', { a: 3 })
  eq(t.events.length, 3, '3 个事件')
  eq(t.filter('x').length, 2, 'filter x → 2')
  eq(t.filter('x')[1].data.a, 3, '第二个 x data')

  const s = new SharedState({ x: 1 })
  s.set('y', 2)
  eq(s.get('x'), 1, 'get x')
  eq(s.get('y'), 2, 'get y')
  s.update({ z: 3 })
  eq(s.toJSON(), { x: 1, y: 2, z: 3 }, 'toJSON')
  ok(s.keys.includes('z'), 'keys 含 z')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
