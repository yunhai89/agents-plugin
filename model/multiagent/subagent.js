/**
 * SubagentSpec —— 隔离子代理的配置。runTask 构造全新 Agent（无 session/memory/recall/guard → 纯隔离上下文），
 * 跑到完成，返回 content（压缩摘要回传 orchestrator）。对应文档 §3.5 上下文隔离 + §2.4 worker 角色。
 *
 * makeDelegationTool —— 把 SubagentSpec 注册为 Orchestrator 可调用的工具（agent-as-tool，文档 §3.2）。
 */
import { Agent } from '../agent/Agent.js'

export class SubagentSpec {
  constructor({
    name,
    description,
    systemPrompt,
    tools,
    model,
    maxTurns = 10,
    provider,
    ...agentConfig
  } = {}) {
    if (!name) throw new Error('SubagentSpec 需要 name')
    if (!provider) throw new Error('SubagentSpec 需要 provider')
    this.name = name
    this.description = description || `子代理 ${name}`
    this.systemPrompt = systemPrompt || `你是${name}，专注于完成分配给你的任务，给出简洁结果。`
    this.tools = tools || null
    this.model = model
    this.maxTurns = maxTurns
    this.provider = provider
    this.agentConfig = agentConfig
  }

  /** 在全新隔离上下文中执行任务，返回 content（压缩摘要） */
  async runTask(task, opts = {}) {
    const agent = new Agent({
      provider: this.provider,
      model: this.model,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
      maxTurns: this.maxTurns,
      ...this.agentConfig,
      // 不传 session/recall/memory/guard/policy → 纯隔离
    })
    const result = await agent.run(task, opts)
    return result.content || ''
  }
}

/**
 * 构造委派工具（agent-as-tool）。Orchestrator 调用时 → Semaphore 限流 → SubagentSpec.runTask → 压缩结果。
 */
export function makeDelegationTool(spec, { semaphore, trace } = {}) {
  return {
    name: `delegate__${spec.name}`,
    description: `委派任务给「${spec.name}」：${spec.description}。传入 { task: 具体的任务描述（自包含：目标+输出格式+边界）}。`,
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '给子代理的具体任务描述' },
      },
      required: ['task'],
    },
    category: 'query',
    meta: { subagent: true, spec },
    async execute(params = {}) {
      const task = typeof params === 'string' ? params : params.task || ''
      if (semaphore) await semaphore.acquire()
      try {
        if (trace) trace.emit('delegate:start', { subagent: spec.name, task })
        const result = await spec.runTask(task)
        if (trace) trace.emit('delegate:end', { subagent: spec.name, resultLength: (result || '').length })
        return result
      } catch (e) {
        if (trace) trace.emit('delegate:error', { subagent: spec.name, error: e?.message || String(e) })
        return `子代理 ${spec.name} 出错：${e?.message || e}`
      } finally {
        if (semaphore) semaphore.release()
      }
    },
  }
}
