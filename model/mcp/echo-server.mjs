#!/usr/bin/env node
/**
 * 最小 MCP 服务端（stdio 传输）—— 用于测试与示例。
 * 提供 echo（回显参数）与 add（两数相加）两个工具。
 * 不依赖任何库，纯标准 JSON-RPC over 换行分隔的 stdin/stdout。
 */
const PROTOCOL_VERSION = '2025-06-18'

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (line) {
      try { handle(JSON.parse(line)) } catch { /* 跳过非 JSON 行 */ }
    }
  }
})

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return
  switch (msg.method) {
    case 'initialize':
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0.0' } } })
      break
    case 'notifications/initialized':
      break
    case 'ping':
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
      break
    case 'tools/list':
      send({
        jsonrpc: '2.0', id: msg.id,
        result: {
          tools: [
            { name: 'echo', description: '原样回显 text 参数', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
            { name: 'add', description: '两数相加', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
          ],
        },
      })
      break
    case 'tools/call': {
      const { name, arguments: args = {} } = msg.params || {}
      if (name === 'echo') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: String(args.text ?? '') }], isError: false } })
      else if (name === 'add') send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: String((Number(args.a) || 0) + (Number(args.b) || 0)) }], isError: false } })
      else send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true } })
      break
    }
    case 'shutdown':
      send({ jsonrpc: '2.0', id: msg.id, result: null })
      break
    default:
      if (msg.id != null) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } })
  }
}
