/**
 * ToolRegistry —— 工具注册、发现与协议格式转换。
 *
 * Tool 契约（能力本身，"能不能做"，模型直接调用执行）：
 *   { name, description, parameters(JSONSchema),
 *     execute(params, ctx): Promise<string|object>,
 *     category?, meta? }
 *
 * AOP：register 时自动包装 execute，集中打印"调用入参 / 耗时 / 结果 / 错误"日志。
 *      无论工具作者是否写日志、无论从哪条路径调用，都经此切面，统一可观测。
 * register 为变参（支持单个 / 多个 / 数组 / 嵌套数组），修复"spread 只注册首个"的隐患。
 */

function brief(v, n = 160) {
  let s
  if (v == null) s = String(v)
  else if (typeof v === 'string') s = v
  else { try { s = JSON.stringify(v) } catch { s = String(v) } }
  s = String(s).replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s
}

export class ToolRegistry {
  constructor({ logger = () => {} } = {}) {
    this.tools = new Map()
    this.logger = logger
  }

  /** 注入日志器（AOP 切面用它打印） */
  setLogger(logger) {
    this.logger = logger || (() => {})
    return this
  }

  /**
   * 注册工具（变参）：register(t1, t2, ...) / register(array) / register(...array) 均可。
   * 自动用 AOP 包装 execute，集中日志。
   */
  register(...tools) {
    for (const tool of tools.flat(Infinity).filter(Boolean)) {
      if (!tool || !tool.name) throw new Error('工具必须包含 name')
      if (typeof tool.execute !== 'function') throw new Error(`工具 ${tool.name} 必须包含 execute 函数`)
      this.tools.set(tool.name, this.#wrap(tool))
    }
    return this
  }

  /** AOP 包装：调用前后统一打日志、计时；出错打 warn 并抛出（由调用方归一为 {error}）。
   *  MCP 工具(meta.mcp)用其专用 logger、默认 info 级（调用可见）；其余工具仅 debug。 */
  #wrap(tool) {
    const self = this
    const orig = tool.execute
    const name = tool.name
    const meta = tool.meta || {}
    const isMcp = !!meta.mcp
    const lg = typeof meta.logger === 'function' ? meta.logger : self.logger
    return {
      ...tool,
      execute: async function (params, ctx) {
        const t0 = Date.now()
        if (isMcp) lg('info', `调用 ${name}`, '参数=', brief(params))
        else self.logger('debug', 'tool call', name, 'args=', brief(params))
        try {
          const r = await orig.call(this, params, ctx)
          if (isMcp) lg('info', `完成 ${name}`, `耗时=${Date.now() - t0}ms`)
          else self.logger('debug', 'tool done', name, `ms=${Date.now() - t0}`, 'preview=', brief(r, 140))
          return r
        } catch (e) {
          lg('warn', 'tool error', name, e?.message || e, 'args=', brief(params))
          throw e
        }
      },
    }
  }

  unregister(name) {
    return this.tools.delete(name)
  }

  has(name) {
    return this.tools.has(name)
  }

  get(name) {
    return this.tools.get(name)
  }

  list() {
    return [...this.tools.values()]
  }

  names() {
    return [...this.tools.keys()]
  }

  /** 按名称集合或谓词筛选子集 */
  match({ names, predicate } = {}) {
    let list = this.list()
    if (names) {
      const set = new Set(names)
      list = list.filter((t) => set.has(t.name))
    }
    if (typeof predicate === 'function') list = list.filter(predicate)
    return list
  }

  /** 转 OpenAI tools 格式 */
  toOpenaiTools() {
    return this.list().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} },
      },
    }))
  }

  /** 转 Anthropic tools 格式 */
  toAnthropicTools() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description || '',
      input_schema: t.parameters || { type: 'object', properties: {} },
    }))
  }
}

export { brief }
