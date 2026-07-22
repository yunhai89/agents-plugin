/**
 * McpManager —— 多 MCP 服务端编排。
 * 按配置连接多个服务端（stdio 子进程 / HTTP），各自工具以 `${prefix}__${tool}` 命名空间
 * 注册进同一个 ToolRegistry，避免跨服务端工具名冲突；提供统一 status / remove / stop。
 *
 * 服务端配置：
 *   { transport?: 'stdio'|'http', command?, args?, env?, cwd?      // stdio
 *     url?, headers?, listen?, sessionId?, fetcher?                 // http
 *     prefix?, category?, filter?, enabled?, clientInfo?, requestTimeout?,
 *     onSampling?, onRoots?, onElicitation? }
 */

import { MCPClient } from './client.js'
import { StdioTransport } from './transport/stdio.js'
import { HttpTransport } from './transport/http.js'
import { loadMcpTools } from './bridge.js'

export function buildTransport(cfg = {}) {
  // 预构建的传输实例直接复用（便于测试注入）
  if (cfg.transport && typeof cfg.transport === 'object') return cfg.transport
  if (cfg.transport === 'http' || (!cfg.transport && cfg.url)) {
    return new HttpTransport({
      url: cfg.url,
      headers: cfg.headers || {},
      sessionId: cfg.sessionId,
      listen: cfg.listen,
      fetcher: cfg.fetcher,
      requestTimeout: cfg.requestTimeout,
    })
  }
  // 默认 stdio
  if (!cfg.command) throw new Error(`MCP 服务端配置需要 command(stdio) 或 url(http)`)
  return new StdioTransport({ command: cfg.command, args: cfg.args || [], env: cfg.env, cwd: cfg.cwd })
}

export class McpManager {
  constructor({ registry, logger = () => {}, requestTimeout } = {}) {
    if (!registry) throw new Error('McpManager 需要 registry')
    this.registry = registry
    this.logger = logger
    this.requestTimeout = requestTimeout
    this._entries = new Map()
  }

  _prefix(cfg, name) {
    return cfg.prefix != null ? cfg.prefix : name
  }

  async add(name, cfg = {}) {
    if (this._entries.has(name)) await this.remove(name)
    const client = new MCPClient({
      transport: buildTransport({ ...cfg, name }),
      clientInfo: cfg.clientInfo,
      requestTimeout: cfg.requestTimeout || this.requestTimeout,
    })
    if (cfg.onSampling) client.onSampling = cfg.onSampling
    if (cfg.onRoots) client.onRoots = cfg.onRoots
    if (cfg.onElicitation) client.onElicitation = cfg.onElicitation

    const entry = { name, client, config: cfg, status: 'connecting', tools: 0, error: null }
    this._entries.set(name, entry)
    try {
      await client.connect()
      const prefix = this._prefix(cfg, name)
      const count = await loadMcpTools(client, this.registry, { prefix, category: cfg.category, filter: cfg.filter })
      entry.tools = count
      entry.status = 'connected'
      this.logger('info', `[mcp] ${name} 已连接，注册 ${count} 个工具（${prefix}__*）`)
    } catch (e) {
      entry.status = 'error'
      entry.error = e?.message || String(e)
      this.logger('error', `[mcp] ${name} 连接失败：${entry.error}`)
    }
    return entry
  }

  async remove(name) {
    const e = this._entries.get(name)
    if (!e) return
    const prefix = this._prefix(e.config, name)
    for (const t of this.registry.list()) {
      if (t.name === prefix || t.name.startsWith(`${prefix}__`)) this.registry.unregister(t.name)
    }
    try { await e.client.close() } catch { /* noop */ }
    this._entries.delete(name)
  }

  /** 批量启动；servers 为 { name: cfg } 或 [{ name, ...cfg }]；enabled:false 跳过 */
  async start(servers = {}) {
    const list = Array.isArray(servers)
      ? servers.map((s) => [s.name, s]).filter(([_, c]) => c && c.enabled !== false)
      : Object.entries(servers).filter(([_, c]) => c && c.enabled !== false)
    await Promise.allSettled(list.map(([n, c]) => this.add(n, c)))
  }

  async stop() {
    for (const name of [...this._entries.keys()]) await this.remove(name)
  }

  status() {
    const out = {}
    for (const [name, e] of this._entries) {
      out[name] = { status: e.status, tools: e.tools, serverInfo: e.client.serverInfo, error: e.error }
    }
    return out
  }

  get(name) { return this._entries.get(name)?.client || null }
  get size() { return this._entries.size }
}
