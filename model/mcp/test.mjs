/**
 * 离线自检 —— in-memory 配对伪服务端 + stdio 真子进程 + http 注入 fetcher。
 * 运行：node model/mcp/test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MCPClient,
  StdioTransport,
  HttpTransport,
  JsonRpcChannel,
  JsonRpcError,
  ERR,
  METHODS,
  PROTOCOL_VERSION,
  loadMcpTools,
  mcpResultToString,
  parseSSE,
  McpManager,
  resolveCategory,
  buildTransport,
  normalizeServerCfg,
  unwrapServers,
} from './index.js'
import { Agent, ToolRegistry, createPolicy } from '../agent/index.js'

let passed = 0
let failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
function eq(a, b, m) { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, `${m}${s ? '' : `  (got ${JSON.stringify(a)})`}`) }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e); console.error(e?.stack) } }
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function expectReject(p, check, m) { let e = null; try { await p } catch (err) { e = err }; ok(!!e && (check ? check(e) : true), m) }

// ---- in-memory 配对传输 ----
function mkLocal() {
  return {
    _other: null,
    _onMessage: () => {}, _onError: () => {}, _onClose: () => {},
    set onMessage(fn) { this._onMessage = fn || (() => {}) },
    set onError(fn) { this._onError = fn || (() => {}) },
    set onClose(fn) { this._onClose = fn || (() => {}) },
    async start() {},
    async send(obj) { const o = this._other; queueMicrotask(() => { try { o._onMessage(obj) } catch (e) { o._onError(e) } }) },
    async close() {},
  }
}
function pipe() { const a = mkLocal(); const b = mkLocal(); a._other = b; b._other = a; return [a, b] }
function fakeServer(serverT, handlers, onNotify) {
  const ch = new JsonRpcChannel({
    send: (o) => serverT.send(o),
    onRequest: async (m, p) => { const h = handlers[m]; if (!h) throw new JsonRpcError(ERR.METHOD_NOT_FOUND, `not found: ${m}`); return h(p) },
    onNotification: (m, p) => onNotify?.(m, p),
  })
  serverT.onMessage = (msg) => ch.receive(msg)
  return ch
}
function mkHeaders(obj = {}) { const map = {}; for (const k in obj) map[String(k).toLowerCase()] = obj[k]; return { get: (k) => (k ? map[String(k).toLowerCase()] ?? null : null) } }
function mockProvider(responses) {
  let i = 0
  return {
    async chat() {
      const r = responses[Math.min(i, responses.length - 1)]
      i++
      return { role: 'assistant', content: r.content ?? '', toolCalls: r.toolCalls || [], reasoning: null, finishReason: r.finishReason || 'stop', usage: null, rawMessage: {} }
    },
  }
}

// ---------- 1. JSON-RPC 信道 ----------
await test('JSON-RPC：request/notify/error/timeout', async () => {
  const [a, b] = pipe()
  const ca = new JsonRpcChannel({ send: (o) => a.send(o) })
  const cb = new JsonRpcChannel({
    send: (o) => b.send(o),
    onRequest: async (m, p) => { if (m === 'throw') throw new JsonRpcError(ERR.INVALID_PARAMS, 'bad'); if (m === 'slow') { await delay(50); return {} } return { method: m, got: p } },
    onNotification: (m, p) => { if (m === 'hi') ca._lastNotify = p },
  })
  a.onMessage = (m) => ca.receive(m)
  b.onMessage = (m) => cb.receive(m)

  const r = await ca.request('ping', { x: 1 })
  eq(r.method, 'ping', 'request 响应')
  eq(r.got.x, 1, 'params 回传')

  await ca.notify('hi', { v: 9 })
  await delay(5)
  eq(ca._lastNotify.v, 9, '通知送达对端')

  await expectReject(ca.request('throw', {}), (e) => e.code === ERR.INVALID_PARAMS, '错误码 reject')
  await expectReject(ca.request('slow', {}, { timeout: 10 }), (e) => /timeout/.test(e.message), '请求超时 reject')
})

// ---------- 2-5. MCPClient（连伪服务端） ----------
let client, server, toolsChanged = 0
await test('MCPClient：connect + initialized', async () => {
  const [ct, st] = pipe()
  let initSeen = false
  server = fakeServer(st, {
    [METHODS.INITIALIZE]: () => ({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'fake', version: '1' } }),
    [METHODS.PING]: () => ({}),
    [METHODS.TOOLS_LIST]: () => ({ tools: [{ name: 'echo', description: '回显', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }),
    [METHODS.TOOLS_CALL]: (p) => (p.name === 'echo' ? { content: [{ type: 'text', text: p.arguments.text || '' }], isError: false } : { content: [{ type: 'text', text: `unknown ${p.name}` }], isError: true }),
    [METHODS.RESOURCES_LIST]: () => ({ resources: [{ uri: 'file:///x', name: 'x', mimeType: 'text/plain' }] }),
    [METHODS.RESOURCES_READ]: (p) => ({ contents: [{ uri: p.uri, mimeType: 'text/plain', text: 'hello' }] }),
    [METHODS.PROMPTS_LIST]: () => ({ prompts: [{ name: 'greet', description: 'g' }] }),
    [METHODS.PROMPTS_GET]: (p) => ({ messages: [{ role: 'user', content: { type: 'text', text: `hi ${p.name || ''}` } }] }),
  }, (m) => { if (m === METHODS.INITIALIZED) initSeen = true; if (m === METHODS.TOOLS_LIST_CHANGED) toolsChanged++ })
  client = new MCPClient({ transport: ct, requestTimeout: 1000 })
  const res = await client.connect()
  eq(res.serverInfo.name, 'fake', 'serverInfo')
  ok(client.serverCapabilities.tools, 'server capabilities')
  ok(client.isConnected, 'isConnected')
  await delay(5)
  ok(initSeen, 'initialized 通知已发')
})

await test('MCPClient：tools / resources / prompts', async () => {
  await client.ping()
  const tl = await client.listTools()
  eq(tl.tools[0].name, 'echo', 'tools/list')
  const tr = await client.callTool('echo', { text: 'hi' })
  eq(tr.content[0].text, 'hi', 'tools/call')
  eq(tr.isError, false, '非错误')
  const err = await client.callTool('nope', {})
  eq(err.isError, true, '未知工具 isError')

  const rl = await client.listResources()
  eq(rl.resources[0].uri, 'file:///x', 'resources/list')
  const rr = await client.readResource('file:///x')
  eq(rr.contents[0].text, 'hello', 'resources/read')

  const pl = await client.listPrompts()
  eq(pl.prompts[0].name, 'greet', 'prompts/list')
  const pg = await client.getPrompt('greet')
  eq(pg.messages[0].content.text, 'hi greet', 'prompts/get')
})

await test('MCPClient：server→client（sampling + 变更通知）', async () => {
  client.onSampling = async () => ({ role: 'assistant', content: { type: 'text', text: 'sampled' }, model: 'fake' })
  const sampRes = await server.request(METHODS.SAMPLING_CREATE, { messages: [] })
  eq(sampRes.content.text, 'sampled', 'sampling/createMessage 经钩子响应')

  let changed = false
  client.onToolsChanged = () => { changed = true }
  server.notify(METHODS.TOOLS_LIST_CHANGED)
  await delay(5)
  ok(changed, 'tools/list_changed 触发 onToolsChanged')

  // 未设 onRoots → roots/list 返回 method-not-found
  await expectReject(server.request(METHODS.ROOTS_LIST, {}), (e) => e.code === ERR.METHOD_NOT_FOUND, '未支持的 server 请求返回 -32601')
})

// ---------- 6. bridge + Agent 端到端 ----------
await test('bridge：loadMcpTools + mcpResultToString', async () => {
  eq(mcpResultToString({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb', '全文本拼接')
  eq(mcpResultToString({ content: [], isError: true }), '{"error":true}', '空+错误')
  const structured = JSON.parse(mcpResultToString({ content: [{ type: 'image', data: 'x' }] }))
  eq(structured.content[0].type, 'image', '非文本结构化')

  const registry = new ToolRegistry()
  const n = await loadMcpTools(client, registry, { prefix: 'mcp' })
  eq(n, 1, '注册 1 个工具')
  ok(registry.has('mcp__echo'), '带前缀注册')
  const out = await registry.get('mcp__echo').execute({ text: 'ping' })
  eq(out, 'ping', '执行 MCP 工具 → 回显')

  // Agent 调用 MCP 工具
  let i = 0
  const mockProvider = {
    async chat() {
      const r = [({ toolCalls: [{ id: 'c1', name: 'mcp__echo', arguments: { text: 'pong' } }], finishReason: 'tool_calls' }), ({ content: 'done', finishReason: 'stop' })][Math.min(i, 1)]
      i++
      return { role: 'assistant', content: r.content ?? '', toolCalls: r.toolCalls || [], reasoning: null, finishReason: r.finishReason, usage: null, rawMessage: {} }
    },
  }
  const agent = new Agent({ provider: mockProvider, tools: registry, maxTurns: 5 })
  const res = await agent.run('请回显 pong')
  eq(res.content, 'done', 'Agent 经 MCP 工具完成循环')
})

// ---------- 7. stdio 真子进程 ----------
await test('StdioTransport：连 echo-server.mjs 子进程', async () => {
  const echoPath = fileURLToPath(new URL('./echo-server.mjs', import.meta.url))
  const t = new StdioTransport({ command: process.execPath, args: [echoPath] })
  const c = new MCPClient({ transport: t, requestTimeout: 3000 })
  await c.connect()
  eq(c.serverInfo.name, 'echo', 'server=echo')
  const tl = await c.listTools()
  eq(tl.tools.length, 2, '两个工具')
  const r = await c.callTool('add', { a: 2, b: 3 })
  eq(r.content[0].text, '5', 'add 2+3=5')
  const e = await c.callTool('echo', { text: '你好' })
  eq(e.content[0].text, '你好', 'echo 中文')
  await c.close()
})

// ---------- 7b. 服务端启动即崩溃 → 快速失败（不再空等到超时） ----------
await test('StdioTransport：服务端启动即退出 → connect 快速失败并带退出码/stderr', async () => {
  const t = new StdioTransport({ command: process.execPath, args: ['-e', "console.error('FATAL: missing API key'); process.exit(1)"] })
  const c = new MCPClient({ transport: t, requestTimeout: 60000 }) // 故意给长超时，验证不再空等
  const t0 = Date.now()
  let err = null
  try { await c.connect() } catch (e) { err = e }
  ok(!!err, 'connect 被 reject')
  ok(Date.now() - t0 < 5000, `快速失败（<5s，实际 ${Date.now() - t0}ms，不再空等超时）`)
  ok(/退出码 1/.test(err.message), '错误含退出码 1')
  ok(/FATAL/.test(err.message), '错误含 stderr 末尾')
})

await test('StdioTransport：command 不存在（ENOENT）→ connect 快速失败', async () => {
  const t = new StdioTransport({ command: 'no-such-command-xyz-999', args: [] })
  const c = new MCPClient({ transport: t, requestTimeout: 60000 })
  const t0 = Date.now()
  let err = null
  try { await c.connect() } catch (e) { err = e }
  ok(!!err, 'connect 被 reject')
  ok(Date.now() - t0 < 5000, `快速失败（<5s，实际 ${Date.now() - t0}ms）`)
  ok(/ENOENT|不在 PATH|spawn/i.test(err.message), '错误提示 ENOENT / PATH')
})

await test('McpManager：连接失败信息含命令行与排查提示（用户可读）', async () => {
  const registry = new ToolRegistry()
  const logs = []
  const mgr = new McpManager({ registry, logger: (lvl, m) => logs.push(m) })
  const entry = await mgr.add('crash', { command: process.execPath, args: ['-e', "console.error('no key'); process.exit(2)"], requestTimeout: 60000 })
  eq(entry.status, 'error', 'status=error')
  ok(/命令：/.test(entry.error), '错误含命令行')
  ok(/常见原因/.test(entry.error), '错误含排查提示')
  ok(/退出码 2/.test(entry.error), '错误含退出码 2')
  ok(/no key/.test(entry.error), '错误含 stderr 末尾')
  ok(logs.some((m) => /连接失败/.test(m)), 'logger 输出连接失败')
})

// ---------- 8. http 注入 fetcher ----------
await test('HttpTransport：POST + Session-Id + SSE 解析', async () => {
  eq(parseSSE('data: {"jsonrpc":"2.0","id":1,"result":{"x":1}}\n\ndata: [DONE]\n\n').length, 1, 'parseSSE 忽略 [DONE]')
  eq(parseSSE('event: msg\ndata: {"a":1}\n\n')[0].a, 1, 'parseSSE 解析')

  const sent = []
  const fetcher = async (url, opts) => {
    sent.push({ url, opts })
    const body = JSON.parse(opts.body)
    const id = body.id
    if (body.method === 'notifications/initialized') return { ok: true, status: 202, headers: mkHeaders({}), async text() { return '' } }
    const result = body.method === 'initialize' ? { protocolVersion: PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: 'h', version: '1' } } : {}
    return {
      ok: true, status: 200,
      headers: mkHeaders({ 'content-type': 'application/json', 'mcp-session-id': 'sess-123' }),
      async text() { return JSON.stringify({ jsonrpc: '2.0', id, result }) },
    }
  }
  const t = new HttpTransport({ url: 'https://x/mcp', fetcher })
  const c = new MCPClient({ transport: t, requestTimeout: 2000 })
  await c.connect()
  eq(t.sessionId, 'sess-123', 'Mcp-Session-Id 跟踪')
  await c.ping()
  ok(sent[0].opts.headers.Accept.includes('text/event-stream'), 'Accept 含 SSE')
  ok(sent.find((s) => s.opts.headers['Mcp-Session-Id'] === 'sess-123'), '后续请求带 Session-Id')

  // SSE 响应
  const sseFetcher = async (url, opts) => {
    const body = JSON.parse(opts.body)
    return {
      ok: true, status: 200,
      headers: mkHeaders({ 'content-type': 'text/event-stream' }),
      async text() { return `data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { ok: 1 } })}\n\n` },
    }
  }
  const t2 = new HttpTransport({ url: 'https://x/mcp', fetcher: sseFetcher })
  let received = null
  t2.onMessage = (m) => { received = m }
  await t2.send({ jsonrpc: '2.0', id: 7, method: 'ping', params: {} })
  eq(received.result.ok, 1, 'SSE 响应被解析投递')
})

// ---------- 9. resources/subscribe + elicitation + updated ----------
await test('MCPClient：subscribe / updated / elicitation', async () => {
  const [ct, st] = pipe()
  const subs = []
  const server = fakeServer(st, {
    [METHODS.INITIALIZE]: () => ({ protocolVersion: PROTOCOL_VERSION, capabilities: { resources: { subscribe: true } }, serverInfo: { name: 's', version: '1' } }),
    [METHODS.RESOURCES_SUBSCRIBE]: (p) => { subs.push(p.uri); return {} },
    [METHODS.RESOURCES_UNSUBSCRIBE]: (p) => { const i = subs.indexOf(p.uri); if (i >= 0) subs.splice(i, 1); return {} },
  })
  const client = new MCPClient({ transport: ct, requestTimeout: 1000 })
  await client.connect()

  await client.subscribeResource('file:///log')
  eq(subs[0], 'file:///log', 'subscribe 登记')
  let updated = null
  client.onResourceUpdated = (p) => { updated = p.uri }
  server.notify('notifications/resources/updated', { uri: 'file:///log' })
  await delay(5)
  eq(updated, 'file:///log', 'resources/updated 触发 onResourceUpdated')

  await client.unsubscribeResource('file:///log')
  eq(subs.length, 0, 'unsubscribe 移除')

  // elicitation：服务端发起 → onElicitation
  client.onElicitation = async (req) => ({ action: 'accept', content: { type: 'text', text: 'ok' } })
  const el = await server.request('elicitation/create', { message: '输入名字', requestedSchema: { type: 'string' } })
  eq(el.action, 'accept', 'elicitation 经钩子响应')
})

// ---------- 10. HTTP 增量 SSE + 服务端请求经流到达 ----------
await test('HttpTransport：增量 SSE 投递 + 服务端请求经流触发响应', async () => {
  const enc = new TextEncoder()
  const streamOf = (chunks) => new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close() } })
  const posts = []
  const fetcher = async (url, opts) => {
    const body = JSON.parse(opts.body)
    posts.push(body)
    if (body.method) {
      // 请求 → 返回 SSE 流：含一条通知 + 服务端 sampling 请求 + 本请求结果
      const stream = streamOf([
        `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { hello: 1 } })}\n\n`,
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: 777, method: 'sampling/createMessage', params: {} })}\n\n`,
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { ok: 1 } })}\n\n`,
      ])
      return { ok: true, status: 200, headers: mkHeaders({ 'content-type': 'text/event-stream' }), body: stream }
    }
    // 响应（对服务端 sampling 的回复）→ 202 空
    return { ok: true, status: 202, headers: mkHeaders({}), async text() { return '' } }
  }

  const t = new HttpTransport({ url: 'https://x/mcp', fetcher })
  let note = null
  const ch = new JsonRpcChannel({
    send: (o) => t.send(o),
    onRequest: async (m, p) => {
      if (m === METHODS.SAMPLING_CREATE) return { role: 'assistant', content: { type: 'text', text: 'sampled' }, model: 'm' }
      throw new JsonRpcError(-32601, 'nf')
    },
    onNotification: (m, p) => { if (m === 'notifications/message') note = p },
  })
  t.onMessage = (m) => ch.receive(m)

  const result = await ch.request('doSomething', {})
  eq(result.ok, 1, '请求经 SSE 流拿到结果')
  eq(note.hello, 1, '流内通知被投递')
  // 服务端 sampling 请求经流到达 → 客户端 POST 了响应
  const sampResp = posts.find((p) => p.id === 777 && p.result)
  ok(sampResp && sampResp.result.content.text === 'sampled', '服务端请求经流触发响应 POST')
})

// ---------- 11. HTTP startListen 常驻推送 ----------
await test('HttpTransport：startListen GET 推送流', async () => {
  const enc = new TextEncoder()
  const streamOf = (chunks) => new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close() } })
  let gets = 0
  const fetcher = async (url, opts) => {
    if (opts.method === 'GET') {
      gets++
      return { ok: true, status: 200, headers: mkHeaders({ 'content-type': 'text/event-stream', 'mcp-session-id': 'L1' }), body: streamOf([`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { tick: gets } })}\n\n`]) }
    }
    return { ok: true, status: 202, headers: mkHeaders({}), async text() { return '' } }
  }
  const t = new HttpTransport({ url: 'https://x/mcp', fetcher, listenRetry: 50 })
  const seen = []
  t.onMessage = (m) => seen.push(m)
  await t.startListen()
  await delay(5)
  ok(seen.length >= 1, 'GET 推送流投递消息')
  eq(t.sessionId, 'L1', 'listen 记录 session id')
  await t.stopListen()
})

// ---------- 12. McpManager 多服务端 ----------
await test('McpManager：多服务端命名空间注册 + status/remove', async () => {
  // 两个 in-memory 服务端
  function mkFakeServer(serverT, toolName) {
    return fakeServer(serverT, {
      [METHODS.INITIALIZE]: () => ({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: toolName + '-srv', version: '1' } }),
      [METHODS.TOOLS_LIST]: () => ({ tools: [{ name: toolName, description: toolName, inputSchema: { type: 'object' } }] }),
      [METHODS.TOOLS_CALL]: (p) => ({ content: [{ type: 'text', text: `${toolName}:${JSON.stringify(p.arguments)}` }], isError: false }),
    })
  }
  const [c1, s1] = pipe(); mkFakeServer(s1, 'tool_a')
  const [c2, s2] = pipe(); mkFakeServer(s2, 'tool_b')

  const registry = new ToolRegistry()
  const mgr = new McpManager({ registry, logger: () => {} })
  await mgr.start({ srvA: { transport: c1, prefix: 'a' }, srvB: { transport: c2, prefix: 'b' } })

  ok(registry.has('a__tool_a') && registry.has('b__tool_b'), '两服务端工具按前缀注册')
  eq(mgr.size, 2, 'size=2')
  const status = mgr.status()
  eq(status.srvA.status, 'connected', 'srvA connected')

  // 调用
  const ra = await registry.get('a__tool_a').execute({ x: 1 })
  eq(ra, 'tool_a:{"x":1}', 'srvA 工具经 manager 可调用')

  await mgr.remove('srvA')
  ok(!registry.has('a__tool_a') && registry.has('b__tool_b'), 'remove 仅清该服务端工具')
  await mgr.stop()
  eq(registry.has('b__tool_b'), false, 'stop 清空全部')
})

// ---------- 13. resolveCategory：string/function/map ----------
await test('bridge.resolveCategory：三形态', async () => {
  const t = { name: 'read_file' }
  eq(resolveCategory(t, 'system'), 'system', 'string')
  eq(resolveCategory(t, (x) => (x.name.startsWith('read') ? 'query' : 'system')), 'query', 'function')
  eq(resolveCategory({ name: 'write' }, { read_file: 'query', default: 'system' }), 'system', 'map→default')
  eq(resolveCategory(t, { read_file: 'query', default: 'system' }), 'query', 'map→命名')
  eq(resolveCategory(t, null), 'query', 'null→query')
})

// ---------- 14. MCP 工具 × RBAC：按类别走权限 ----------
await test('端到端：MCP 工具按 category 走 RBAC（member 拒 system、放行 query）', async () => {
  const [ct, st] = pipe()
  fakeServer(st, {
    [METHODS.INITIALIZE]: () => ({ protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'm', version: '1' } }),
    [METHODS.TOOLS_LIST]: () => ({ tools: [
      { name: 'read', description: 'read', inputSchema: { type: 'object' } },
      { name: 'delete', description: 'delete', inputSchema: { type: 'object' } },
    ] }),
    [METHODS.TOOLS_CALL]: (p) => ({ content: [{ type: 'text', text: p.name }], isError: false }),
  })
  const client = new MCPClient({ transport: ct, requestTimeout: 1000 })
  await client.connect()
  const registry = new ToolRegistry()
  await loadMcpTools(client, registry, { prefix: 'svc', category: { read: 'query', delete: 'system', default: 'query' } })
  eq(registry.get('svc__read').category, 'query', 'read→query')
  eq(registry.get('svc__delete').category, 'system', 'delete→system')

  const policy = createPolicy()
  eq(policy.decide({ role: 'member', isMaster: false }, registry.get('svc__delete')).decision, 'deny', 'member→system deny')
  eq(policy.decide({ role: 'member', isMaster: false }, registry.get('svc__read')).decision, 'allow', 'member→query allow')
  eq(policy.decide({ role: 'member', isMaster: true }, registry.get('svc__delete')).decision, 'allow', 'master→system allow')

  // Agent 层：member 调 svc__delete → 被 policy 拒（rejected_by_policy）
  const agent = new Agent({
    provider: mockProvider([
      { toolCalls: [{ id: 'c1', name: 'svc__delete', arguments: {} }], finishReason: 'tool_calls' },
      { content: 'ok', finishReason: 'stop' },
    ]),
    tools: registry,
    policy: createPolicy(),
    maxTurns: 5,
  })
  const res = await agent.run('删', { ctx: { role: 'member', isMaster: false, userId: 'u', groupId: 'g' } })
  eq(JSON.parse(res.messages[2].content).error, 'rejected_by_policy', 'Agent 经 MCP 工具被 RBAC 拒')
  eq(res.content, 'ok', '循环继续到最终回复')
})

// ---------- 格式兼容：标准 mcpServers / type 字段 ----------
await test('normalizeServerCfg：type → transport（Claude Desktop 格式）', async () => {
  eq(normalizeServerCfg({ type: 'stdio', command: 'npx' }).transport, 'stdio', 'type:stdio→transport:stdio')
  eq(normalizeServerCfg({ type: 'http', url: 'x' }).transport, 'http', 'type:http→transport:http')
  eq(normalizeServerCfg({ type: 'sse', url: 'x' }).transport, 'http', 'type:sse→http')
  eq(normalizeServerCfg({ transport: 'http' }).transport, 'http', '已有 transport 不覆盖')
  eq(normalizeServerCfg({ command: 'npx' }).transport, undefined, '无 type 不强加 transport')
})

await test('unwrapServers：解包 { mcpServers: {...} }', async () => {
  const wrapped = { mcpServers: { zai: { type: 'stdio', command: 'npx' } } }
  const unw = unwrapServers(wrapped)
  ok(unw.zai && !unw.mcpServers, '解出 zai，去掉 mcpServers 包装')
  const plain = { zai: { command: 'npx' } }
  eq(unwrapServers(plain), plain, '无包装原样返回')
  // 用户实际误配：servers.mcpServers.name（多套一层）
  const misNested = { mcpServers: { 'zai-mcp-server': { type: 'stdio', command: 'npx' } } }
  ok(unwrapServers(misNested)['zai-mcp-server'], '修复用户误把 mcpServers 当 server 键的情况')
})

await test('buildTransport：type:stdio + command/args/env 构建 stdio', async () => {
  const t = buildTransport({ type: 'stdio', command: 'npx', args: ['-y', '@z_ai/mcp-server'], env: { K: 'v' } })
  ok(t && t.constructor.name === 'StdioTransport', 'type:stdio → StdioTransport')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
