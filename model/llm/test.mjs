/**
 * 离线自检 —— LLM 高可用层。运行：node model/llm/test.mjs
 */
import {
  detectCapabilities,
  CircuitBreaker,
  CircuitOpenError,
  ProviderPool,
  embed,
  LLM,
} from './index.js'

let passed = 0
let failed = 0
function ok(c, m) {
  if (c) {
    passed++
    console.log('  ✓', m)
  } else {
    failed++
    console.error('  ✗ FAIL', m)
  }
}
function eq(a, b, m) {
  const same = JSON.stringify(a) === JSON.stringify(b)
  ok(same, `${m}${same ? '' : `  (got ${JSON.stringify(a)})`}`)
}
async function test(name, fn) {
  console.log(`\n[${name}]`)
  try {
    await fn()
  } catch (e) {
    failed++
    console.error('  ✗ THROW', e?.message || e)
    console.error(e?.stack)
  }
}
const retriable = (msg = 'rate') => Object.assign(new Error(msg), { isRetryable: true })
const biz = (msg = 'bad') => Object.assign(new Error(msg), { isRetryable: false })

// ---------- 1. 能力注册表 ----------
await test('capabilities：分层判定', async () => {
  eq(detectCapabilities({ protocol: 'openai', model: 'gpt-4o' }).vision, true, 'gpt-4o vision')
  eq(detectCapabilities({ protocol: 'openai', model: 'gpt-4o' }).source, 'registry', 'source=registry')
  eq(detectCapabilities({ protocol: 'anthropic', model: 'claude-sonnet-4-5' }).thinking, true, 'claude thinking')
  eq(detectCapabilities({ protocol: 'anthropic', model: 'claude-sonnet-4-5' }).caching, true, 'claude caching')
  eq(detectCapabilities({ protocol: 'openai', model: 'deepseek-reasoner' }).thinking, true, 'deepseek-reasoner thinking')
  eq(detectCapabilities({ protocol: 'openai', model: 'mimo-v2.5-pro' }).thinking, true, 'mimo thinking')
  eq(detectCapabilities({ protocol: 'openai', model: 'qwen-vl-max' }).vision, true, 'qwen-vl vision')
  // 协议默认：未知模型 openai 仍有 tools
  eq(detectCapabilities({ protocol: 'openai', model: 'totally-unknown' }).tools, true, '未知模型 protocol default tools')
  eq(detectCapabilities({ protocol: 'openai', model: 'totally-unknown' }).source, 'default', 'source=default')
  // 配置覆盖最高
  eq(detectCapabilities({ protocol: 'openai', model: 'gpt-4o', caps: { vision: false } }).vision, false, 'config 覆盖 vision=false')
  eq(detectCapabilities({ protocol: 'openai', model: 'gpt-4o', caps: { vision: false } }).source, 'config', 'source=config')
})

// ---------- 2. 熔断器 ----------
await test('circuit：closed→open→half_open→closed', async () => {
  let t = 1000
  const clock = () => t
  const br = new CircuitBreaker({ threshold: 3, cooldown: 10000, now: clock })
  eq(br.state, 'closed', '初始 closed')
  br.failure(); br.failure()
  eq(br.state, 'closed', '2 次未达 threshold 仍 closed')
  br.failure()
  eq(br.state, 'open', '3 次 trip → open')
  ok(!br.allow(), 'open + 冷却中 拒绝')
  eq(br.retryAfter > 0, true, 'retryAfter > 0')
  t += 10000
  ok(br.allow(), '冷却到期 → half_open 放行')
  eq(br.state, 'half_open', '状态 half_open')
  br.success()
  eq(br.state, 'closed', 'half_open 成功 → closed')

  // half_open 再失败立即 trip
  const br2 = new CircuitBreaker({ threshold: 2, cooldown: 5000, now: clock })
  br2.failure(); br2.failure()
  eq(br2.state, 'open', 'br2 open')
  t += 5000
  ok(br2.allow(), 'br2 → half_open')
  br2.failure()
  eq(br2.state, 'open', 'half_open 失败立即回 open')
})

// ---------- 3. 池：failover / round_robin / least_errors ----------
await test('pool：failover 到下一成员', async () => {
  const calls = []
  const p1 = { async chat() { calls.push('p1'); throw retriable() } }
  const p2 = { async chat() { calls.push('p2'); return { content: 'ok' } } }
  const pool = new ProviderPool({ members: [{ name: 'a', provider: p1 }, { name: 'b', provider: p2 }], strategy: 'failover' })
  const res = await pool.chat({})
  eq(res.content, 'ok', '取到 p2 结果')
  eq(calls, ['p1', 'p2'], '先 p1 失败再 p2')
})

await test('pool：4xx 业务错误不转移', async () => {
  const calls = []
  const p1 = { async chat() { calls.push('p1'); throw biz('bad request') } }
  const p2 = { async chat() { calls.push('p2'); return { content: 'ok' } } }
  const pool = new ProviderPool({ members: [{ name: 'a', provider: p1 }, { name: 'b', provider: p2 }] })
  let err = null
  try {
    await pool.chat({})
  } catch (e) {
    err = e
  }
  eq(calls, ['p1'], '不转移')
  ok(/bad request/.test(err.message), '直传业务错误')
})

await test('pool：round_robin 轮询', async () => {
  let c1 = 0
  let c2 = 0
  const p1 = { async chat() { c1++; return 1 } }
  const p2 = { async chat() { c2++; return 2 } }
  const pool = new ProviderPool({ members: [{ name: 'a', provider: p1 }, { name: 'b', provider: p2 }], strategy: 'round_robin' })
  await pool.chat({}); await pool.chat({}); await pool.chat({})
  eq(c1, 2, 'p1 调 2 次')
  eq(c2, 1, 'p2 调 1 次')
})

await test('pool：跳过 open 熔断器', async () => {
  const br = new CircuitBreaker({ threshold: 1 })
  br.failure() // open
  const p1 = { async chat() { throw retriable() } }
  const p2 = { async chat() { return { c: 2 } } }
  const pool = new ProviderPool({ members: [{ name: 'a', provider: p1 }, { name: 'b', provider: p2 }], breakers: { a: br } })
  const res = await pool.chat({})
  eq(res.c, 2, '跳过熔断的 a，取 b')
})

await test('pool：least_errors 选失败最少的', async () => {
  const br1 = new CircuitBreaker(); br1.failure(); br1.failure(); br1.failure()
  const br2 = new CircuitBreaker(); br2.failure()
  const p1 = { async chat() { return { who: 1 } } }
  const p2 = { async chat() { return { who: 2 } } }
  const pool = new ProviderPool({
    members: [{ name: 'a', provider: p1 }, { name: 'b', provider: p2 }],
    strategy: 'least_errors',
    breakers: { a: br1, b: br2 },
  })
  const res = await pool.chat({})
  eq(res.who, 2, '选失败数更少的 b')
})

// ---------- 4. 池：流式首 chunk 前故障转移 ----------
await test('pool：流式首 chunk 前可转移、之后直传', async () => {
  const p1 = { async chat() { return (async function* () { throw retriable('stream-rate') })() } }
  const p2 = { async chat() { return (async function* () { yield { text: 'a' }; yield { text: 'b' } })() } }
  const pool = new ProviderPool({ members: [{ name: 'a', provider: p1 }, { name: 'b', provider: p2 }] })
  const out = []
  for await (const s of await pool.chat({ stream: true })) out.push(s)
  eq(out, [{ text: 'a' }, { text: 'b' }], '首 chunk 前失败 → 转移到 p2')
})

// ---------- 5. embed ----------
await test('embed：按 index 排序 + 形状保持', async () => {
  const fetcher = async (url, opts) => ({
    ok: true,
    status: 200,
    async json() {
      return { data: [{ index: 1, embedding: [0.2, 0.2] }, { index: 0, embedding: [0.1, 0.1] }] }
    },
  })
  const client = { baseURL: 'https://x/v1', apiKey: 'k', fetcher }
  const vec = await embed('hello', { client, fetcher })
  eq(vec, [0.1, 0.1], '单串 → index0 向量')
  const arr = await embed(['a', 'b'], { client, fetcher })
  eq(arr, [[0.1, 0.1], [0.2, 0.2]], '数组 → 排序后的向量数组')

  // 校验请求体
  let sentBody = null
  const f2 = async (url, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, status: 200, async json() { return { data: [{ index: 0, embedding: [1] }] } } } }
  await embed('x', { client, fetcher: f2, model: 'text-embedding-3-large' })
  eq(sentBody.model, 'text-embedding-3-large', 'model 透传')
  eq(sentBody.input, ['x'], 'input 数组')
})

// ---------- 6. 门面 LLM ----------
await test('LLM 门面：define/pool/capabilities', async () => {
  LLM.reset()
  LLM.define('p', {
    protocol: 'openai',
    defaultModel: 'gpt-4o',
    client: { baseURL: 'https://x' },
    chat: async () => ({ content: 'ok' }),
  })
  ok(LLM.has('p'), '已注册')
  const cap = LLM.capabilities('p')
  eq(cap.vision, true, 'gpt-4o vision')
  const pool = LLM.pool('default', { members: ['p'] })
  ok(pool instanceof ProviderPool, '创建池')
  const res = await LLM.chat({})
  eq(res.content, 'ok', '门面 chat 走 default 池')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
