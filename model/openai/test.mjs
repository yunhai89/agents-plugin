/**
 * 离线自检 —— 注入 mock fetch，无需联网 / API Key。
 * 运行：node model/openai/test.mjs
 */
import {
  createClient,
  presets,
  msg,
  parseToolArguments,
  extractReasoning,
  APIError,
  TimeoutError,
} from './index.js'

let passed = 0
let failed = 0

function ok(cond, m) {
  if (cond) {
    passed++
    console.log('  [32m✓[0m', m)
  } else {
    failed++
    console.error('  [31m✗ FAIL[0m', m)
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
    console.error('  [31m✗ THROW[0m', e?.message || e)
    console.error(e?.stack)
  }
}

// ---------- mock helpers ----------
function mkHeaders(obj = {}) {
  const map = {}
  for (const k in obj) map[String(k).toLowerCase()] = obj[k]
  return {
    get: (k) => (k ? map[String(k).toLowerCase()] ?? null : null),
  }
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
function errRes(status, error, headers = {}) {
  return {
    ok: false,
    status,
    headers: mkHeaders(headers),
    async text() {
      return JSON.stringify({ error })
    },
  }
}
function sseRes(sseString, { status = 200, headers = {} } = {}) {
  const enc = new TextEncoder()
  const body = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(sseString))
      c.close()
    },
  })
  return { ok: status >= 200 && status < 300, status, headers: mkHeaders(headers), body }
}
function counter() {
  const calls = { count: 0 }
  const fn = (responder) => async (url, opts) => {
    calls.count++
    return typeof responder === 'function' ? responder(calls.count, url, opts) : responder
  }
  return { calls, fn }
}

// ---------- 1. 非流式 + 解析 ----------
await test('非流式：返回 spec 原始响应 + 工具参数/推理解析', async () => {
  const canned = {
    id: 'chatcmpl-x',
    object: 'chat.completion',
    model: 'deepseek-chat',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '你好',
          reasoning_content: '我的思考',
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } },
          ],
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  }
  const client = createClient({ ...presets.deepseek, fetch: async () => jsonRes(canned) })
  const res = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: [msg.user('hi')],
  })
  eq(res.id, 'chatcmpl-x', '原样透传 id')
  eq(res.choices[0].message.content, '你好', '提取 content')
  eq(
    extractReasoning(res.choices[0].message, client.reasoningFields),
    '我的思考',
    'extractReasoning 读到 reasoning_content',
  )
  eq(parseToolArguments(res.choices[0].message.tool_calls[0]), { a: 1 }, 'parseToolArguments 解析为对象')
})

// ---------- 2. 流式聚合 + 增量顺序 ----------
await test('流式：增量顺序与聚合结果', async () => {
  const sse = [
    'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}',
    'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}',
    'data: {"choices":[{"index":0,"delta":{"content":" world"}}]}',
    'data: {"choices":[{"index":0,"delta":{"reasoning_content":"思A"}}]}',
    'data: {"choices":[{"index":0,"delta":{"reasoning_content":"思B"}}]}',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"北京\\"}"}}]}}]}',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
    'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
    'data: [DONE]',
    '',
  ].join('\n\n')

  const client = createClient({ ...presets.deepseek, fetch: async () => sseRes(sse) })
  const stream = await client.chat.completions.create({
    model: 'deepseek-reasoner',
    messages: [msg.user('北京天气？')],
    stream: true,
    stream_options: { include_usage: true },
  })

  const contents = []
  const reasonings = []
  const toolNames = []
  for await (const part of stream) {
    if (part.delta.content) contents.push(part.delta.content)
    if (part.delta.reasoning) reasonings.push(part.delta.reasoning)
    if (part.delta.toolCalls) for (const t of part.delta.toolCalls) if (t.name) toolNames.push(t.name)
  }

  eq(contents, ['Hello', ' world'], 'content 增量顺序')
  eq(reasonings, ['思A', '思B'], 'reasoning 增量顺序（字段归一化）')
  eq(toolNames, ['get_weather'], '工具名增量')
  eq(stream.content, 'Hello world', '聚合 content')
  eq(stream.reasoning, '思A思B', '聚合 reasoning')
  eq(stream.finishReason, 'tool_calls', 'finishReason')
  eq(stream.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, 'usage 原样保留')
  eq(
    stream.toolCalls,
    [
      {
        index: 0,
        id: 'call_1',
        type: 'function',
        name: 'get_weather',
        arguments: { city: '北京' },
        argumentsRaw: '{"city":"北京"}',
      },
    ],
    'toolCalls 聚合并解析参数',
  )
  eq(
    stream.assistantMessage,
    {
      role: 'assistant',
      content: 'Hello world',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"北京"}' } },
      ],
    },
    'assistantMessage spec 对齐',
  )
})

// ---------- 3. 重试：429 → 200 ----------
await test('重试：429(rate_limit_exceeded) 后成功', async () => {
  const { calls, fn } = counter()
  const fetcher = fn((n) =>
    n === 1
      ? errRes(429, { message: 'rate', type: 'rate_limit_error', code: 'rate_limit_exceeded' }, { 'retry-after': '0' })
      : jsonRes({ id: 'ok', choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] }),
  )
  const retries = []
  const client = createClient({
    ...presets.openai,
    fetch: fetcher,
    maxRetries: 4,
    retryDelay: () => 0,
    onRetry: (r) => retries.push(r),
  })
  const res = await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [msg.user('x')] })
  eq(res.id, 'ok', '最终成功')
  eq(calls.count, 2, '共请求 2 次（1 失败 + 1 成功）')
  eq(retries.length, 1, 'onRetry 触发 1 次')
})

// ---------- 4. 400 不重试 ----------
await test('错误：400 不重试，抛 APIError', async () => {
  const { calls, fn } = counter()
  const fetcher = fn(() => errRes(400, { message: 'bad req', type: 'invalid_request_error', code: 'invalid_model' }))
  const client = createClient({ ...presets.openai, fetch: fetcher, maxRetries: 4, retryDelay: () => 0 })
  let caught = null
  try {
    await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [msg.user('x')] })
  } catch (e) {
    caught = e
  }
  ok(caught instanceof APIError, '抛出 APIError')
  eq(caught?.status, 400, 'status=400')
  eq(caught?.code, 'invalid_model', 'code 透传')
  eq(caught?.isRetryable, false, '不可重试')
  eq(calls.count, 1, '仅请求 1 次')
})

// ---------- 429 insufficient_quota 不重试 ----------
await test('错误：429 insufficient_quota 不重试', async () => {
  const { calls, fn } = counter()
  const fetcher = fn(() => errRes(429, { message: 'no quota', code: 'insufficient_quota' }))
  const client = createClient({ ...presets.openai, fetch: fetcher, maxRetries: 4, retryDelay: () => 0 })
  let caught = null
  try {
    await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [msg.user('x')] })
  } catch (e) {
    caught = e
  }
  eq(caught?.status, 429, 'status=429')
  eq(caught?.isRetryable, false, '额度不足不可重试')
  eq(calls.count, 1, '仅请求 1 次')
})

// ---------- 5. 超时 ----------
await test('超时：永不响应 → TimeoutError 并耗尽重试', async () => {
  const { calls, fn } = counter()
  const fetcher = fn((_n, _url, opts) =>
    new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => {
        const e = new Error('aborted')
        e.name = 'AbortError'
        reject(e)
      })
    }),
  )
  const client = createClient({
    ...presets.openai,
    fetch: fetcher,
    timeout: 20,
    maxRetries: 1,
    retryDelay: () => 0,
  })
  let caught = null
  try {
    await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [msg.user('x')] })
  } catch (e) {
    caught = e
  }
  ok(caught instanceof TimeoutError, '抛出 TimeoutError')
  eq(calls.count, 2, '尝试 2 次（maxRetries=1）')
})

// ---------- 6. 重新适配：MiMo 预设 + reasoning_content + 非标字段透传 ----------
await test('重新适配：MiMo 预设 baseURL + reasoning_content + 非标字段透传', async () => {
  let sentUrl = null
  let sentBody = null
  const fetcher = async (url, opts) => {
    sentUrl = url
    sentBody = JSON.parse(opts.body)
    return jsonRes({
      id: 'ok',
      choices: [{ index: 0, message: { role: 'assistant', content: '答案', reasoning_content: '推理' }, finish_reason: 'stop' }],
    })
  }
  const client = createClient({ ...presets.mimo, apiKey: 'sk-mimo', fetch: fetcher })
  const res = await client.chat.completions.create({
    model: 'mimo-v2.5-pro',
    messages: [msg.user('x')],
    thinking: { type: 'enabled' },
    temperature: 0.7,
  })
  ok(sentUrl.startsWith('https://api.xiaomimimo.com/v1/chat/completions'), 'MiMo OpenAI baseURL')
  eq(res.choices[0].message.reasoning_content, '推理', 'reasoning_content 透传')
  eq(extractReasoning(res.choices[0].message, client.reasoningFields), '推理', 'extractReasoning 读到 reasoning_content')
  eq(sentBody.thinking, { type: 'enabled' }, 'thinking 非标字段原样进 body')
  eq(sentBody.temperature, 0.7, 'temperature 透传')
})

// ---------- 6b. 重新适配：Moonshot 不再强制 temperature=1 ----------
await test('重新适配：Moonshot temperature 原样透传（移除强制钩子）', async () => {
  let sentUrl = null
  let sentBody = null
  const fetcher = async (url, opts) => {
    sentUrl = url
    sentBody = JSON.parse(opts.body)
    return jsonRes({ id: 'ok', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })
  }
  const client = createClient({ ...presets.moonshot, apiKey: 'k', fetch: fetcher })
  await client.chat.completions.create({
    model: 'kimi-k2.6',
    messages: [msg.user('x')],
    temperature: 0.3,
  })
  eq(sentBody.temperature, 0.3, 'temperature 原样保留（不再强制为 1）')
  ok(sentUrl.startsWith('https://api.moonshot.'), 'moonshot baseURL')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`[1m通过 ${passed}，失败 ${failed}[0m`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
