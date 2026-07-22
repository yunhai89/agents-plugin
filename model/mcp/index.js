/**
 * 通用 MCP 客户端库 —— 公共出口。
 *
 * 让 Agent 消费任意 MCP 服务端（stdio 子进程 / Streamable HTTP）的工具、资源、prompt。
 *
 * 用法：
 *   import { MCPClient, StdioTransport, loadMcpTools } from '../../model/mcp/index.js'
 *   const client = new MCPClient({ transport: new StdioTransport({ command:'npx', args:['-y','@modelcontextprotocol/server-filesystem','./'] }) })
 *   await client.connect()
 *   await loadMcpTools(client, registry, { prefix:'fs' })
 *   // 现在 Agent 可调用 fs__read_file 等工具
 */

import { MCPClient } from './client.js'
import { BaseTransport } from './transport/base.js'
import { StdioTransport } from './transport/stdio.js'
import { HttpTransport, parseSSE } from './transport/http.js'
import {
  JsonRpcChannel,
  JsonRpcError,
  JSONRPC,
  ERR,
  makeRequest,
  makeNotification,
  makeResponse,
  makeErrorResponse,
  isResponse,
  isRequest,
  isNotification,
} from './jsonrpc.js'
import { PROTOCOL_VERSION, METHODS, CONTENT, LOG_LEVELS } from './protocol.js'
import { loadMcpTools, mcpResultToString, resolveCategory } from './bridge.js'
import { McpManager, buildTransport } from './manager.js'

export {
  MCPClient,
  BaseTransport,
  StdioTransport,
  HttpTransport,
  parseSSE,
  JsonRpcChannel,
  JsonRpcError,
  JSONRPC,
  ERR,
  makeRequest,
  makeNotification,
  makeResponse,
  makeErrorResponse,
  isResponse,
  isRequest,
  isNotification,
  PROTOCOL_VERSION,
  METHODS,
  CONTENT,
  LOG_LEVELS,
  loadMcpTools,
  mcpResultToString,
  resolveCategory,
  McpManager,
  buildTransport,
}
