/**
 * 离线自检 —— 注入 mock fetch，无需联网 / API Key。
 * 运行：node model/anthropic/test.mjs
 */
import {
  createClient,
  presets,
  msg,
  block,
  tool,
  extractText,
  extractThinking,
  extractToolUses,
  APIError,
} from './index.js'

let passed = 0
let failed = 0

function ok(cond, m) {
  if (cond) {
    passed++
    console.log('  [32m✓[0m', m)
  } else {
    failed++
    console.error('  [31m✗ FAIL[0m', m)
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
    console.error('  [31m✗ THROW[0m', e?.message || e)
    console.error(e?.stack)
  }
}

// ---------- mock helpers ----------
function mkHeaders(obj = {}) {
  const map = {}
  for (const k in obj) map[String(k).toLowerCase()] = obj[k]
  return { get: (k) => (k ? map[String(k).toLowerCase()] ?? null : null) }
}
function jsonRes(data, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: mkHeaders(headers),
    async text() {
      return JSON.stringify(data)
    },
  }
}
function errRes(status, errorBody, headers = {}) {
  // Anthropic 错误体：{ type:'error', error:{ type, message } }
  return {
    ok: false,
    status,
    headers: mkHeaders(headers),
    async text() {
      return JSON.stringify({ type: 'error', error: errorBody })
    },
  }
}
function sseRes(events, { status = 200, headers = {} } = {}) {
  // events: 数组，每项 { event, data(object) } → 序列化为 "event: x\ndata: {...}\n\n"
  const sse = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}`)
    .join('\n\n')
  const enc = new TextEncoder()
  const body = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(sse))
      c.close()
    },
  })
  return { ok: status >= 200 && status < 300, status, headers: mkHeaders(headers), body }
}
function counter() {
  const calls = { count: 0, lastUrl: null, lastOpts: null }
  const fn = (responder) => async (url, opts) => {
    calls.count++
    calls.lastUrl = url
    calls.lastOpts = opts
    return typeof responder === 'function' ? responder(calls.count, url, opts) : responder
  }
  return { calls, fn }
}

// ---------- 1. 非流式 + content blocks 解析 ----------
await test('非流式：content blocks（text/thinking/tool_use）+ 缓存 usage', async () => {
  const canned = {
    id: 'msg_02',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [
      { type: 'thinking', thinking: '我的推理', signature: 'Sig1' },
      { type: 'text', text: '答案是 42' },
      { type: 'tool_use', id: 'toolu_02', name: 'calc', input: { q: '1+1' } },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: {
      input_tokens: 20,
      output_tokens: 5,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 50,
    },
  }
  const client = createClient({ ...presets.anthropic, apiKey: 'k', fetch: async () => jsonRes(canned) })
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [msg.user('hi')],
  })
  eq(res.id, 'msg_02', '原样透传 id')
  eq(res.stop_reason, 'tool_use', 'stop_reason')
  eq(extractText(res.content), '答案是 42', 'extractText')
  eq(extractThinking(res.content), '我的推理', 'extractThinking')
  eq(extractToolUses(res.content), [{ id: 'toolu_02', name: 'calc', input: { q: '1+1' } }], 'extractToolUses')
  eq(res.usage.cache_creation_input_tokens, 100, '缓存创建 token')
})

// ---------- 2. 流式：命名事件聚合 ----------
await test('流式：thinking + text + tool_use 增量与聚合', async () => {
  const events = [
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_01', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先思考一下' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'Eu1mAA' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '你好' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '！' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: {} } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"city":' } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"北京"}' } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 2 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 42 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]

  const client = createClient({ ...presets.anthropic, apiKey: 'k', fetch: async () => sseRes(events) })
  const stream = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1024,
    messages: [msg.user('北京天气？')],
    stream: true,
  })

  const texts = []
  const thinkings = []
  const partials = []
  for await (const ev of stream) {
    if (ev.text) texts.push(ev.text)
    if (ev.thinking) thinkings.push(ev.thinking)
    if (ev.partialJson) partials.push(ev.partialJson)
  }

  eq(texts, ['你好', '！'], 'text 增量顺序')
  eq(thinkings, ['先思考一下'], 'thinking 增量')
  eq(partials, ['{"city":', '"北京"}'], '工具输入 JSON 片段顺序')
  eq(stream.text, '你好！', '聚合 text')
  eq(stream.thinking, '先思考一下', '聚合 thinking')
  eq(stream.id, 'msg_01', 'id')
  eq(stream.model, 'claude-sonnet-4-5-20250929', 'model')
  eq(stream.stopReason, 'tool_use', 'stopReason')
  eq(
    stream.usage,
    { input_tokens: 12, output_tokens: 42, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    'usage 合并（message_start 输入 + message_delta 输出）',
  )
  eq(
    stream.toolUses,
    [{ id: 'toolu_01', name: 'get_weather', input: { city: '北京' } }],
    'toolUses 聚合并解析 input',
  )
  eq(
    stream.content,
    [
      { type: 'thinking', thinking: '先思考一下', signature: 'Eu1mAA' },
      { type: 'text', text: '你好！' },
      { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: { city: '北京' } },
    ],
    'content 数组顺序（thinking→text→tool_use）',
  )
  // assistantMessage 可原样回传（thinking 块含 signature 未被修改）
  eq(stream.assistantMessage.role, 'assistant', 'assistantMessage.role')
  eq(
    stream.assistantMessage.content[0],
    { type: 'thinking', thinking: '先思考一下', signature: 'Eu1mAA' },
    '回传时 thinking 块原样保留（含 signature）',
  )
})

// ---------- 3. 认证头：x-api-key + anthropic-version ----------
await test('认证头：官方用 x-api-key + anthropic-version', async () => {
  const { calls, fn } = counter()
  const fetcher = fn(() => jsonRes({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
  const client = createClient({ ...presets.anthropic, apiKey: 'sk-ant', fetch: fetcher })
  await client.messages.create({ model: 'claude-sonnet-4-5-20250929', max_tokens: 10, messages: [msg.user('x')] })
  const h = calls.lastOpts.headers
  eq(h['x-api-key'], 'sk-ant', '发送 x-api-key')
  eq(h['anthropic-version'], '2023-06-01', '发送 anthropic-version')
})

// ---------- 3b. MiMo 用 api-key 头 ----------
await test('认证头：MiMo 用 api-key（非 x-api-key）', async () => {
  const { calls, fn } = counter()
  const fetcher = fn(() => jsonRes({ id: 'm', type: 'message', role: 'assistant', model: 'mimo-v2.5-pro', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
  const client = createClient({ ...presets.mimo, apiKey: 'sk-mimo', fetch: fetcher })
  await client.messages.create({ model: 'mimo-v2.5-pro', max_tokens: 10, messages: [msg.user('x')] })
  const h = calls.lastOpts.headers
  eq(h['api-key'], 'sk-mimo', 'MiMo 发送 api-key 头')
  ok(!h['x-api-key'], 'MiMo 不发送 x-api-key')
  ok(calls.lastUrl.startsWith('https://api.xiaomimimo.com/anthropic'), 'MiMo Anthropic baseURL')
})

// ---------- 4. 重试：429 → 200 ----------
await test('重试：429 后成功', async () => {
  const { calls, fn } = counter()
  const fetcher = fn((n) =>
    n === 1
      ? errRes(429, { type: 'rate_limit_error', message: 'rate' }, { 'retry-after': '0' })
      : jsonRes({ id: 'ok', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
  )
  const client = createClient({ ...presets.anthropic, apiKey: 'k', fetch: fetcher, maxRetries: 4, retryDelay: () => 0 })
  const res = await client.messages.create({ model: 'claude-sonnet-4-5-20250929', max_tokens: 10, messages: [msg.user('x')] })
  eq(extractText(res.content), 'done', '最终成功')
  eq(calls.count, 2, '请求 2 次')
})

// ---------- 5. 529 overloaded 可重试 ----------
await test('重试：529 overloaded 可重试后成功', async () => {
  const { calls, fn } = counter()
  const fetcher = fn((n) =>
    n === 1
      ? errRes(529, { type: 'overloaded_error', message: 'Overloaded' })
      : jsonRes({ id: 'ok', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
  )
  const client = createClient({ ...presets.anthropic, apiKey: 'k', fetch: fetcher, maxRetries: 4, retryDelay: () => 0 })
  const res = await client.messages.create({ model: 'claude-sonnet-4-5-20250929', max_tokens: 10, messages: [msg.user('x')] })
  eq(extractText(res.content), 'done', '529 后重试成功')
  eq(calls.count, 2, '请求 2 次')
})

// ---------- 6. 400 不重试 ----------
await test('错误：400 不重试，抛 APIError', async () => {
  const { calls, fn } = counter()
  const fetcher = fn(() => errRes(400, { type: 'invalid_request_error', message: 'bad' }))
  const client = createClient({ ...presets.anthropic, apiKey: 'k', fetch: fetcher, maxRetries: 4, retryDelay: () => 0 })
  let caught = null
  try {
    await client.messages.create({ model: 'claude-sonnet-4-5-20250929', max_tokens: 10, messages: [msg.user('x')] })
  } catch (e) {
    caught = e
  }
  ok(caught instanceof APIError, '抛出 APIError')
  eq(caught?.status, 400, 'status=400')
  eq(caught?.type, 'invalid_request_error', 'type 透传')
  eq(caught?.isRetryable, false, '不可重试')
  eq(calls.count, 1, '仅请求 1 次')
})

// ---------- 7. max_tokens 必填校验 ----------
await test('校验：缺少 max_tokens 抛错', async () => {
  const client = createClient({ ...presets.anthropic, apiKey: 'k', fetch: async () => jsonRes({}) })
  let caught = null
  try {
    await client.messages.create({ model: 'claude-sonnet-4-5-20250929', messages: [msg.user('x')] })
  } catch (e) {
    caught = e
  }
  ok(/max_tokens/.test(caught?.message || ''), '抛出含 max_tokens 的错误')
})

// ---------- 8. 工具/工具结果构造器 ----------
await test('构造器：tool.def / block.toolResult 形态正确', async () => {
  const t = tool.def({
    name: 'get_weather',
    description: 'd',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    strict: true,
  })
  eq(t, { name: 'get_weather', description: 'd', input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }, strict: true }, 'tool.def → input_schema + strict')
  eq(tool.choiceTool('get_weather'), { type: 'tool', name: 'get_weather' }, 'choiceTool')
  eq(block.toolResult('toolu_1', 'sunny', true), { type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny', is_error: true }, 'block.toolResult')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`[1m通过 ${passed}，失败 ${failed}[0m`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
