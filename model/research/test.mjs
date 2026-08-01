/**
 * 离线自检 —— mock provider + mock searchManager 驱动完整 DeepResearch 流程。
 * 运行：node model/research/test.mjs
 */
import { DeepResearch, ResearchState, routeStrategy, EFFORT_CONFIG, evaluateReport, quickCheck } from './index.js'
import { markdownToHtml, buildResearchHtml, safeFilename, splitMessage } from './render.js'

let passed = 0, failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
function eq(a, b, m) { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, `${m}${s ? '' : `  (got ${JSON.stringify(a)})`}`) }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e) } }

function mockSearchMgr(results) {
  const calls = { count: 0, queries: [] }
  return {
    calls,
    async search(q) {
      calls.count++; calls.queries.push(q)
      return { provider: 'mock', query: q, answer: '搜索答案', results: results || [{ title: '结果', url: 'https://arxiv.org/abs/1234', content: 'AI Agent 研究', score: 0.9 }] }
    },
    async extract(urls) { return { provider: 'mock', results: [{ url: urls[0], raw_content: '正文' }] } },
  }
}

function smartProvider({ scope, synthesize, cite, judge, researcher } = {}) {
  let researcherCalls = 0
  return {
    calls: { count: 0 },
    async chat(opts) {
      this.calls.count++
      const sys = opts.system || ''
      if (sys.includes('研究规划师')) return { role: 'assistant', content: scope || JSON.stringify({ intent: '研究 AI', subquestions: ['框架对比', '适用场景'], type: 'compare', effort: 'light' }), toolCalls: [], reasoning: null, finishReason: 'stop', usage: null, rawMessage: {} }
      if (sys.includes('研究综合者')) return { role: 'assistant', content: synthesize || '# 报告\n基于研究...[1]\n\n## 来源\n[1] https://arxiv.org/abs/1234', toolCalls: [], reasoning: null, finishReason: 'stop', usage: null, rawMessage: {} }
      if (sys.includes('引用校验员')) return { role: 'assistant', content: cite || '# 报告（已校验）\n基于研究...[1] ✅\n\n## 来源\n[1] https://arxiv.org/abs/1234', toolCalls: [], reasoning: null, finishReason: 'stop', usage: null, rawMessage: {} }
      if (sys.includes('研究质量评审员')) return { role: 'assistant', content: judge || JSON.stringify({ scores: { accuracy: 0.8, citations: 0.7, completeness: 0.9, sourceQuality: 0.8, efficiency: 0.7 }, pass: true, rationale: '通过' }), toolCalls: [], reasoning: null, finishReason: 'stop', usage: null, rawMessage: {} }
      if (sys.includes('研究子代理')) {
        researcherCalls++
        if (researcherCalls === 1) return { role: 'assistant', content: '', toolCalls: [{ id: 's1', name: 'web_search', arguments: { query: 'AI Agent 框架' } }], reasoning: null, finishReason: 'tool_calls', usage: null, rawMessage: {} }
        return { role: 'assistant', content: researcher || `研究发现：LangChain 和 CrewAI 是主流框架 [https://arxiv.org/abs/1234]`, toolCalls: [], reasoning: null, finishReason: 'stop', usage: null, rawMessage: {} }
      }
      return { role: 'assistant', content: 'fallback', toolCalls: [], reasoning: null, finishReason: 'stop', usage: null, rawMessage: {} }
    },
  }
}

// ---------- 1. 完整 DeepResearch 全阶段 ----------
await test('完整 DeepResearch：五阶段 + 外层循环 + 评估', async () => {
  const search = mockSearchMgr()
  const provider = smartProvider()
  const dr = new DeepResearch({ provider, model: 'test', searchManager: search, maxRounds: 2, logger: () => {} })
  const result = await dr.run('研究 AI Agent 框架')

  // Brief
  ok(result.brief.intent === '研究 AI', 'Brief 意图')
  ok(result.brief.subquestions.length >= 2, 'Brief 子问题')
  eq(result.brief.type, 'compare', 'Brief 类型')

  // Plan + Iterate（至少有发现）
  ok(result.findings.length >= 1, '至少 1 个发现')
  ok(result.findings[0].citations.length > 0, '发现含引用')

  // Synthesize
  ok(result.report.length > 0, '报告非空')

  // Cite
  ok(result.report.includes('校验'), '报告含校验标记')

  // Evaluate（§6.3 五维 rubric）
  ok(result.evaluation !== null, '评估已执行')
  ok(result.evaluation.llm?.pass === true, 'LLM judge 通过')
  ok(result.evaluation.quick?.issues !== undefined, '快速检查有 issues')

  // Trace
  const types = result.trace.events.map(e => e.type)
  ok(types.includes('scope:start') && types.includes('scope:end'), 'trace: scope')
  ok(types.includes('round:start'), 'trace: round:start（外层循环）')
  ok(types.includes('delegate:start') && types.includes('delegate:end'), 'trace: delegate')
  ok(types.includes('synthesize:end'), 'trace: synthesize')
  ok(types.includes('cite:end'), 'trace: cite')
  ok(types.includes('evaluate:end'), 'trace: evaluate')
  ok(types.includes('coverage'), 'trace: coverage（覆盖判断）')
  ok(types.includes('strategy'), 'trace: strategy（策略路由）')

  // State
  ok(result.state.findings >= 1, 'state: findings')
  ok(result.state.visitedUrls >= 0, 'state: visitedUrls')
  ok(result.state.toolCalls >= 1, 'state: toolCalls（搜索被调用）')
  ok(result.state.elapsed >= 0, 'state: elapsed')
  ok(result.state.sourceQuality.high >= 1, 'state: 高质量来源（arxiv）')
})

// ---------- 2. ResearchState：状态管理 ----------
await test('ResearchState：去重 + 预算 + 覆盖判断', async () => {
  const s = new ResearchState({ maxRounds: 3, maxToolCalls: 5 })
  s.brief = { intent: 'test', subquestions: ['AI Agent', '框架'], type: 'open', effort: 'light' }
  // URL 去重
  ok(s.shouldVisit('https://a.com'), '首次访问')
  ok(!s.shouldVisit('https://a.com'), '重复 URL 被拦截')
  ok(s.shouldVisit('https://b.com'), '不同 URL 通过')
  // 查询去重
  ok(s.shouldQuery('AI Agent'), '首次查询')
  ok(!s.shouldQuery('AI Agent'), '重复查询被拦截')
  // 预算
  ok(s.consumeToolCall(), '工具调用 1')
  ok(s.consumeToolCall(), '工具调用 2')
  eq(s.toolCalls, 2, 'toolCalls=2')
  // 覆盖判断
  s.addFinding({ task: 'AI Agent', result: 'AI Agent 是智能体框架', citations: ['https://arxiv.org/abs/1'] })
  const cov = s.getCoverageReport()
  ok(cov.total >= 2, '覆盖检查有 >=2 子问题')
  // 预算耗尽
  s.round = 3
  ok(s.budgetExhausted, '轮次预算耗尽')
})

// ---------- 3. 来源质量评估 ----------
await test('来源质量评估（§3.4）', async () => {
  const { scoreSourceQuality, isHighQualitySource } = await import('./state.js')
  eq(scoreSourceQuality('https://arxiv.org/abs/1234'), 'high', 'arxiv → high')
  eq(scoreSourceQuality('https://www.gov.cn/policy'), 'high', '.gov → high')
  eq(scoreSourceQuality('https://mit.edu/research'), 'high', '.edu → high')
  eq(scoreSourceQuality('https://random-blog.com/post'), 'medium', '随机博客 → medium')
  eq(scoreSourceQuality('https://reddit.com/r/ai'), 'low', 'reddit → low')
  ok(isHighQualitySource('https://github.com/repo'), 'github → high')
})

// ---------- 4. 策略路由 ----------
await test('策略路由（§3.3 决策矩阵）', async () => {
  const verify = routeStrategy({ type: 'verify', effort: 'light' })
  ok(verify.maxConcurrent === 1, 'verify → 串行（maxConcurrent=1）')
  ok(verify.breadth === 'depth', 'verify → depth')

  const compare = routeStrategy({ type: 'compare', effort: 'medium' })
  ok(compare.breadth === 'breadth', 'compare → breadth')

  const enumerate = routeStrategy({ type: 'enumerate', effort: 'medium' })
  ok(enumerate.agents >= 4, 'enumerate → agents >= 4')
  ok(enumerate.breadth === 'breadth', 'enumerate → breadth')
})

// ---------- 5. 评估：快速检查 ----------
await test('quickCheck：规则检查', async () => {
  // 长报告但引用少
  const r1 = quickCheck({ report: 'x'.repeat(600), findings: [{ result: '', citations: [] }], brief: { subquestions: ['AI'] } })
  ok(r1.issues.some(i => i.message.includes('引用稀少')), '检测到引用稀少')
  // 子问题未覆盖
  const r2 = quickCheck({ report: 'short', findings: [{ result: '完全无关内容', citations: [] }], brief: { subquestions: ['量子计算', '区块链'] } })
  ok(r2.issues.some(i => i.message.includes('未被覆盖')), '检测到子问题未覆盖')
  // 来源质量低
  const r3 = quickCheck({ report: 'ok', findings: [{ result: 'test', citations: ['https://random-blog.com', 'https://another-blog.com', 'https://more-blogs.com'] }], brief: { subquestions: [] } })
  ok(r3.issues.some(i => i.message.includes('权威来源')), '检测到权威来源占比低')
})

// ---------- 6. 评估：LLM-as-Judge ----------
await test('evaluateReport：LLM-as-Judge 五维 rubric', async () => {
  const result = await evaluateReport({
    provider: smartProvider({ judge: JSON.stringify({ scores: { accuracy: 0.9, citations: 0.8, completeness: 0.85, sourceQuality: 0.7, efficiency: 0.9 }, pass: true, rationale: '质量良好' }) }),
    model: 'test', query: 'AI Agent', report: '报告内容', citations: ['https://arxiv.org/abs/1'],
  })
  eq(result.pass, true, 'judge pass')
  ok(result.scores.accuracy === 0.9, 'judge accuracy')
  ok(result.rationale.includes('良好'), 'judge rationale')
})

// ---------- 报告渲染（markdown → HTML） ----------
await test('render：markdownToHtml 覆盖各语法', async () => {
  const md = [
    '# 标题',
    '',
    '这是**加粗**与*斜体*和`code`，还有~~删除~~。',
    '',
    '- 项一',
    '- 项二',
    '',
    '1. 有序一',
    '2. 有序二',
    '',
    '> 引用块',
    '',
    '[链接](https://x.com)',
    '',
    '```',
    '代码块内容',
    '```',
    '',
    '---',
    '',
    '普通段落。',
  ].join('\n')
  const html = markdownToHtml(md)
  ok(html.includes('<h1>标题</h1>'), 'h1')
  ok(html.includes('<strong>加粗</strong>'), '加粗')
  ok(html.includes('<em>斜体</em>'), '斜体')
  ok(html.includes('<code>code</code>'), '行内 code')
  ok(html.includes('<del>删除</del>'), '删除线')
  ok(html.includes('<ul>') && html.includes('<li>项一</li>'), '无序列表')
  ok(html.includes('<ol>') && html.includes('<li>有序一</li>'), '有序列表')
  ok(html.includes('<blockquote>引用块</blockquote>'), '引用')
  ok(html.includes('<a href="https://x.com">链接</a>'), '链接')
  ok(html.includes('<pre><code>代码块内容</code></pre>'), '代码块')
  ok(html.includes('<hr/>'), '水平线')
  ok(html.includes('<p>普通段落。</p>'), '段落')
})

await test('render：buildResearchHtml 组装', async () => {
  const full = buildResearchHtml({
    topic: 'AI Agent 框架',
    report: '## 结论\n研究结论。',
    citations: ['https://a.com', 'https://b.com'],
    evaluation: { pass: true, score: 8.5 },
    rounds: 2,
  })
  ok(full.includes('<!doctype html>'), '完整文档')
  ok(full.includes('AI Agent 框架'), '封面标题')
  ok(full.includes('评估通过'), '评估徽章')
  ok(full.includes('参考来源'), '来源区')
  ok(full.includes('https://a.com'), '来源链接')
  ok(full.includes('#container'), '容器（puppeteer 截图锚点）')
  // evaluation pass=false → fail 样式
  const f = buildResearchHtml({ topic: 'x', report: 'y', evaluation: { pass: false } })
  ok(f.includes('评估未通过'), '未通过徽章')
})

await test('render：safeFilename 安全化', async () => {
  eq(safeFilename('a/b:c?d'), 'a_b_c_d', '非法字符转下划线')
  ok(safeFilename('正常名称').length > 0, '中文保留')
})

await test('render：splitMessage 分段（防超 QQ 上限）', async () => {
  eq(splitMessage('', 1800), [], '空→[]')
  eq(splitMessage('短', 1800), ['短'], '短→单段')
  const long = Array.from({ length: 60 }, (_, i) => `第${i}段，${'内容文字'.repeat(20)}`).join('\n\n')
  const segs = splitMessage(long, 1800)
  ok(segs.length > 1, '长文本多段')
  ok(segs.every((s) => s.length <= 1800), '每段 ≤ 1800')
  eq(segs.join('\n\n'), long, '拼接无损')
  // 单行超长硬切
  const s2 = splitMessage('X'.repeat(5000), 1800)
  ok(s2.length === 3 && s2.every((s) => s.length <= 1800), '硬切 3 段')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
