/**
 * Agent —— ReAct 主循环（参考 Hermes AIAgent 九步 Turn Lifecycle 与 yunhai lib/agent/loop.js）。
 *
 * 职责：接收输入 → 组装 system → 调 Provider → 工具调用则执行回插 → 循环到文本回复。
 * 基础：迭代预算、AbortSignal、回调、流式、token 压力钩子（既有）。
 * opt-in 运营层（传实例 + ctx 才启用，否则保持现行为）：
 *   - guard：入口注入防御（block/flag/sanitize）+ system 硬化
 *   - session：跨会话历史（group:user 键、KV 持久化）
 *   - recall：向量召回记忆（注入 system + 轮后异步抽取）
 *   - policy + confirm：工具分发前的 RBAC + 审批门
 *   - clarify 短路：指定工具的结果作为最终回复直接退出
 * 库零依赖插件；ctx / kv / logger / key 由上层注入。
 */

import { randomUUID } from 'node:crypto'
import { ExecutionContext } from './tools/context.js'
import { stringifyArgs, estimateMessages, mergeUsage } from './messages.js'
import { TEMPLATES, SERVICE_DIRECTIVE, buildToolCatalogSection, buildSkillsPromptSection, buildAgentSystemPrompt } from '../prompt/index.js'

const DEFAULT_IDENTITY = TEMPLATES.agent.system

/** 紧凑用量日志：兼容 per-turn(prompt/completion_tokens) 与 mergeUsage(input/output/total) 两种形态 */
function fmtUsage(u) {
  if (!u) return null
  const p = u.prompt_tokens ?? u.input_tokens ?? u.input
  const c = u.completion_tokens ?? u.output_tokens ?? u.output
  const t = u.total_tokens ?? u.total
  const parts = []
  if (p != null) parts.push(`in:${p}`)
  if (c != null) parts.push(`out:${c}`)
  if (!parts.length && t != null) parts.push(`tok:${t}`)
  return parts.length ? `{${parts.join(',')}}` : null
}

/** 日志截断：字符串/对象单行化 + 长度截断 */
function brief(v, n = 160) {
  let s
  if (v == null) s = String(v)
  else if (typeof v === 'string') s = v
  else { try { s = JSON.stringify(v) } catch { s = String(v) } }
  s = String(s).replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s
}

export class Agent {
  constructor(config = {}) {
    if (!config.provider) throw new Error('Agent 需要 provider')
    this.provider = config.provider
    this.model = config.model || null
    this.tools = config.tools || null
    this.memory = config.memory || null
    this.skills = config.skills || null

    this.systemPrompt = config.systemPrompt || DEFAULT_IDENTITY
    this.maxTurns = config.maxTurns ?? 90
    this.temperature = config.temperature
    this.maxTokens = config.max_tokens ?? config.maxTokens ?? null
    this.thinking = config.thinking || null
    this.toolChoice = config.tool_choice ?? config.toolChoice ?? null

    this.estimateTokens = config.estimateTokens || null
    this.contextPressureThreshold = config.contextPressureThreshold ?? null
    // 上下文管理（解决长对话膨胀 / token 溢出）
    this.maxToolResultChars = config.maxToolResultChars ?? 4000 // 单条工具结果字符上限，超长截断
    this.keepReasoning = config.keepReasoning === true // 默认 false：不把 reasoning 回灌历史，省 context
    this.contextKeepRecent = config.contextKeepRecent ?? 8 // 压缩时至少保留的尾部消息数
    this.logger = config.logger || (() => {})

    // opt-in 运营层
    this.guard = config.guard || null
    this.guardSensitivity = config.guardSensitivity || 'medium'
    this.guardAction = config.guardAction || 'flag'
    this.blockedMessage = config.blockedMessage || '检测到潜在的指令注入，已拒绝处理。'
    this.policy = config.policy || null
    this.confirm = config.confirm || null
    // 主人发起的任务免确认直执行（高危）：开启后 ctx.isMaster 的确认类工具跳过 #确认，
    // 但经 onMasterAutoApprove 回调发"特别高危提示"。denylist 仍是硬底线（execute 里拦）。
    this.masterSkipConfirm = config.masterSkipConfirm === true
    this.session = config.session || null
    this.recall = config.recall || null
    this.recallTopK = config.recallTopK ?? 5
    this.recallLlm = config.recallLlm || null
    this.shortCircuitTools = config.shortCircuitTools || ['clarify']

    this.messages = []
  }

  setHistory(messages) { this.messages = messages ? messages.map((m) => ({ ...m })) : [] }
  getHistory() { return this.messages }
  reset() { this.messages = [] }

  /**
   * @param {string|object} input 用户文本或消息对象
   * @param {object} opts signal/ctx/onDelta/onReasoning/onToolStart/onToolEnd/onAssistant/onContextPressure/onApprove/onBeforeTool/taskId/stream/...
   *   ctx = { role, isMaster, userId, groupId, isGroup, isGroupAdmin, notify, fetcher, ... }
   */
  async run(input, opts = {}) {
    const cb = {
      onDelta: opts.onDelta,
      onReasoning: opts.onReasoning,
      onToolStart: opts.onToolStart,
      onToolEnd: opts.onToolEnd,
      onAssistant: opts.onAssistant,
      onContextPressure: opts.onContextPressure,
      onApprove: opts.onApprove,
      onBeforeTool: opts.onBeforeTool,
      onMasterAutoApprove: opts.onMasterAutoApprove,
    }
    const signal = opts.signal || null
    const taskId = opts.taskId || randomUUID()
    const ctx = opts.ctx || null
    const wantStream = opts.stream ?? !!cb.onDelta
    // 人设覆盖：传入则替换身份层 systemPrompt，工具/记忆/防护仍照常追加
    const systemPromptOverride = opts.systemPrompt || null
    // 情境感知（skill 注入）：如"首次入群"获取的群信息/聊天记录
    const context = opts.context || null

    const rawText = this._inputText(input)

    // guard：入口注入防御
    let userText = rawText
    if (this.guard) {
      const g = this.guard.checkInput(rawText, { sensitivity: this.guardSensitivity, action: this.guardAction })
      if (g.blocked) {
        this.logger('warn', `输入被 guard 拦截：score=${g.score}`)
        return { content: this.blockedMessage, messages: this.messages, usage: null, turns: 0, taskId, stopReason: 'blocked' }
      }
      userText = g.text // 可能被 isolate/sanitize
    }

    // session：加载历史（conversation 模式 or group:user 模式）
    const useConv = !!(this.session && ctx && ctx.conversationId != null && typeof this.session.getConversation === 'function')
    let sessKey = null
    if (useConv) {
      try { this.messages = await this.session.getConversation(ctx.userId, ctx.conversationId) } catch { this.messages = [] }
    } else if (this.session && ctx) {
      sessKey = this.session.key(ctx.groupId, ctx.userId)
      try { this.messages = await this.session.get(sessKey) } catch { this.messages = [] }
    }
    const sessStart = this.messages.length

    // 追加 user 消息（保留多模态对象形态，仅替换文本内容）
    this.messages.push(this._buildUserMessage(input, userText))

    // recall：检索注入
    let memories = null
    if (this.recall && ctx) {
      try { memories = await this.recall.retrieve(rawText, ctx.userId, this.recallTopK) } catch { memories = null }
    }

    let usage = null
    let turns = 0
    let stopReason = null
    let lastContent = ''
    const toolList = this.tools?.list?.() || []
    const __runStart = Date.now()
    this.logger('mark', 'run start user=', ctx?.userId, 'gid=', ctx?.groupId, 'conv=', ctx?.conversationId, 'inputLen=', rawText.length, 'msgs=', this.messages.length, 'tools=', toolList.length, 'maxTurns=', this.maxTurns)

    while (turns < this.maxTurns) {
      if (signal?.aborted) throw new Error('aborted')

      const system = this._assembleSystem(memories, systemPromptOverride, context)

      if (this.contextPressureThreshold) {
        const est = this._estimateHistory(system)
        if (est > this.contextPressureThreshold) {
          // 实际压缩历史：保留首条 user 意图 + 近期若干条，安全丢弃中段整轮
          const dropped = this._compactMessages(Math.floor(this.contextPressureThreshold * 0.6))
          if (dropped) this.logger('mark', `上下文压力(est=${est}>${this.contextPressureThreshold})：压缩历史，丢弃 ${dropped} 条中段消息`)
          cb.onContextPressure?.({ estimate: est, threshold: this.contextPressureThreshold, dropped, messages: this.messages })
        }
      }

      const __t0 = Date.now()
      const result = await this.provider.chat({
        model: this.model,
        messages: this.messages,
        system,
        tools: toolList.length ? toolList : undefined,
        tool_choice: this.toolChoice,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        thinking: this.thinking,
        signal,
        stream: wantStream,
        onDelta: cb.onDelta,
        onReasoning: cb.onReasoning,
        ...this._extraRunOpts(opts),
      })
      const __ms = Date.now() - __t0
      if (result.usage) usage = mergeUsage(usage, result.usage)
      turns++
      this.logger('debug', `turn ${turns}`, 'model=', this.model, 'finish=', result.finishReason, 'contentLen=', (result.content || '').length, 'toolCalls=', result.toolCalls?.length || 0, 'reasoning=', !!result.reasoning, 'usage=', fmtUsage(result.usage), `ms=${__ms}`)

      const assistantMsg = {
        role: 'assistant',
        content: result.content || null,
        // 默认不回灌 reasoning（keepReasoning=false），避免隐藏 token 持续吃 context
        ...((this.keepReasoning && result.reasoning) ? { reasoning: result.reasoning } : {}),
      }
      if (result.toolCalls?.length) {
        assistantMsg.tool_calls = result.toolCalls.map((tc) => ({
          id: tc.id, type: 'function', function: { name: tc.name, arguments: stringifyArgs(tc.arguments) },
        }))
      }
      this.messages.push(assistantMsg)
      cb.onAssistant?.(result, assistantMsg)
      lastContent = result.content || lastContent

      if (!result.toolCalls?.length) {
        stopReason = result.finishReason || 'end_turn'
        break
      }

      // 执行工具
      const execCtx = new ExecutionContext({ agent: this, taskId, messages: this.messages, signal, logger: this.logger, props: { ctx } })
      const toolResults = await this._executeToolCalls(result.toolCalls, execCtx, cb, ctx)
      for (const trm of toolResults) this.messages.push(trm)

      // clarify 短路：指定工具的结果作为最终回复
      const sc = toolResults.find((tr) => this.shortCircuitTools.includes(tr.name))
      if (sc) {
        let q = sc.content
        try { const o = JSON.parse(q); if (o && o.clarify) q = o.clarify } catch { /* keep raw */ }
        lastContent = String(q)
        this.messages.push({ role: 'assistant', content: lastContent })
        stopReason = 'clarify'
        break
      }
    }

    if (!stopReason) {
      stopReason = 'max_turns'
      this.logger('warn', `Agent 达到 maxTurns(${this.maxTurns})，提前结束`)
    }

    // 持久化 session + 异步抽取记忆
    if (useConv) {
      try { await this.session.appendConversation(ctx.userId, ctx.conversationId, this.messages.slice(sessStart)) } catch (e) { this.logger('warn', 'conversation 持久化失败', e) }
    } else if (sessKey) {
      try { await this.session.append(sessKey, this.messages.slice(sessStart)) } catch (e) { this.logger('warn', 'session 持久化失败', e) }
    }
    if (this.recall && ctx) {
      const snapshot = this.messages.slice()
      const llm = this.recallLlm || null
      setImmediate(() => { try { this.recall.extractAndWrite(snapshot, ctx.userId, { llm }) } catch { /* noop */ } })
    }

    this.logger('mark', 'run end turns=', turns, 'stop=', stopReason, 'usage=', fmtUsage(usage), 'replyLen=', (lastContent || '').length, `totalMs=${Date.now() - __runStart}`)
    return { content: lastContent, messages: this.messages, usage, turns, taskId, stopReason }
  }

  _inputText(input) {
    if (input == null) return ''
    if (typeof input === 'string') return input
    if (typeof input.content === 'string') return input.content
    // 多模态：content 为协议原生块数组时，拼接所有 text 块作为可 Guard/记忆的纯文本
    if (Array.isArray(input.content)) {
      return input.content
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text || '')
        .join('\n')
        .trim()
    }
    try { return JSON.stringify(input) } catch { return '' }
  }

  _buildUserMessage(input, text) {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      // 多模态：apps 经 createMediaService.buildContent 构造的协议原生 content 数组
      // 用 Guard 后的文本置顶/替换 text 块，保留其余媒体块；剥离 _media 标记不入历史
      if (input._media && Array.isArray(input.content)) {
        const nonText = input.content.filter((b) => !b || b.type !== 'text')
        const content = (text ? [{ type: 'text', text }] : []).concat(nonText)
        return { role: input.role || 'user', content }
      }
      return { role: input.role || 'user', ...input, content: text }
    }
    return { role: 'user', content: text }
  }

  _assembleSystem(memories, systemPromptOverride, context) {
    // 结构化分层（稳定前缀 → 动态后缀）：身份 → 服务准则 → 执行取向 → 工具目录 → 技能 → 记忆 → 情境 → 安全
    const identity = systemPromptOverride || this.systemPrompt
    const toolCatalog = this.tools && this.tools.list().length ? buildToolCatalogSection(this.tools.list()) : ''
    const skillsSection = this.skills ? buildSkillsPromptSection(this.skills.catalog()) : ''
    let recalledMemory = ''
    if (this.recall && memories && memories.length) recalledMemory = this.recall.formatForPrompt(memories) || ''
    const memorySnapshot = this.memory ? (this.memory.snapshotAll() || '') : ''
    const guardHardening = this.guard ? (this.guard.systemHardening() || '') : ''
    return buildAgentSystemPrompt({
      identity,
      serviceDirective: SERVICE_DIRECTIVE,
      toolCatalog,
      skillsSection,
      recalledMemory,
      memorySnapshot,
      context,
      guardHardening,
    })
  }

  _estimateHistory(system) {
    const fn = this.estimateTokens || ((t) => Math.ceil((t || '').length / 4))
    let n = fn(system)
    for (const m of this.messages) {
      n += 4
      if (typeof m.content === 'string') n += fn(m.content)
      if (m.reasoning) n += fn(m.reasoning)
      if (m.tool_calls) n += fn(JSON.stringify(m.tool_calls))
    }
    return n
  }

  /** 仅估算 messages（不含 system）的 token 数 */
  _estimateMessagesTokens() {
    const fn = this.estimateTokens || ((t) => Math.ceil((t || '').length / 4))
    let n = 0
    for (const m of this.messages) {
      n += 4
      if (typeof m.content === 'string') n += fn(m.content)
      if (this.keepReasoning && m.reasoning) n += fn(m.reasoning)
      if (m.tool_calls) n += fn(JSON.stringify(m.tool_calls))
    }
    return n
  }

  /**
   * 压缩历史到 maxTokens 以下：保留首条 user 意图 + 尾部 contextKeepRecent 条，
   * 在"安全边界"丢弃中段整轮对话。
   * 安全边界：从 cutStart 起丢一块——若该块是带 tool_calls 的 assistant，连带其后所有
   * tool 结果一起丢，保证不会留下孤立的 tool_result（其触发 assistant 已被移除）。
   * @param {number} maxTokens 目标 messages token 上限
   * @returns {number} 实际丢弃的消息数
   */
  _compactMessages(maxTokens) {
    const minKeep = Math.max(this.contextKeepRecent, 2)
    if (this.messages.length <= minKeep + 1) return 0
    let dropped = 0
    let guard = 0
    // cutStart=1：始终保留 messages[0]（首条 user 意图）
    while (this._estimateMessagesTokens() > maxTokens && this.messages.length > minKeep + 1 && guard++ < 1000) {
      let cutStart = 1
      // 尾部保留 minKeep 条
      const maxCutEnd = this.messages.length - minKeep
      if (cutStart >= maxCutEnd) break
      // 从 cutStart 丢一块：assistant(tool_calls)+其 tool 结果 / 单条 user 或 assistant
      const block = [this.messages[cutStart]]
      if (this.messages[cutStart].tool_calls) {
        let j = cutStart + 1
        while (j < this.messages.length && this.messages[j].role === 'tool') { block.push(this.messages[j]); j++ }
      }
      // 块不能侵入尾部保留区
      if (cutStart + block.length > maxCutEnd) break
      this.messages.splice(cutStart, block.length)
      dropped += block.length
    }
    return dropped
  }

  _extraRunOpts(opts) {
    const reserved = new Set(['signal', 'onDelta', 'onReasoning', 'onToolStart', 'onToolEnd', 'onAssistant', 'onContextPressure', 'onApprove', 'onBeforeTool', 'onMasterAutoApprove', 'taskId', 'stream', 'ctx'])
    const out = {}
    for (const k of Object.keys(opts)) if (!reserved.has(k)) out[k] = opts[k]
    return out
  }

  async _executeToolCalls(toolCalls, execCtx, cb, ctx) {
    const hasInteractive = toolCalls.some((tc) => this.tools?.get?.(tc.name)?.meta?.interactive)
    const runOne = async (tc) => this._executeOne(tc, execCtx, cb, ctx)
    if (hasInteractive) {
      const results = []
      for (const tc of toolCalls) results.push(await runOne(tc))
      return results
    }
    return Promise.all(toolCalls.map((tc) => runOne(tc)))
  }

  async _executeOne(tc, execCtx, cb, ctx) {
    cb.onToolStart?.(tc)
    const tool = this.tools?.get?.(tc.name)
    // 注：工具调用入参/耗时/结果/错误的日志由 ToolRegistry 的 AOP 切面统一打印，
    // 这里只记录调度层关心的 outcome（未注册 / 被策略拦截 / 审批拒绝）。
    let content

    if (!tool) {
      content = stringifyArgs({ error: `Tool '${tc.name}' not found` })
      this.logger('warn', 'tool not_found', tc.name)
    } else {
      // policy + confirm 门（代码层强制，agent 无法绕过）
      const alwaysConfirm = tool?.meta?.alwaysConfirm === true
      if (this.policy && ctx) {
        const dec = this.policy.decide(ctx, tool)
        if (dec.decision === 'deny') {
          content = stringifyArgs({ error: 'rejected_by_policy', reason: dec.reason })
          this.logger('mark', 'tool denied', tc.name, 'reason=', dec.reason)
          cb.onToolEnd?.(tc, content)
          return { role: 'tool', tool_call_id: tc.id, name: tc.name, content }
        }
        // meta.alwaysConfirm（如 terminal）：即便主人/policy 放行，也强制走确认
        let needConfirm = dec.decision === 'confirm' || alwaysConfirm
        // meta.shouldConfirm（按入参否决审批）：如 terminal 的 allowlist 命中 → 免审批直跑
        if (needConfirm && typeof tool?.meta?.shouldConfirm === 'function') {
          try {
            if (await tool.meta.shouldConfirm(tc.arguments, ctx) === false) {
              needConfirm = false
              this.logger('mark', 'tool auto-allow', tc.name, 'meta.shouldConfirm 否决审批（如 allowlist 命中）')
            }
          } catch { /* shouldConfirm 出错保守起见仍走确认 */ }
        }
        if (needConfirm) {
          // 主人免确认（高危）：masterSkipConfirm 开启且当前是主人 → 跳过 #确认、发高危提示。
          // denylist 仍是硬底线（execute 里拦），不会因免确认而放行灾难命令。
          if (this.masterSkipConfirm && ctx?.isMaster) {
            this.logger('warn', '⚠️ 主人任务免确认自动执行（高危）', tc.name, brief(tc.arguments))
            cb.onMasterAutoApprove?.(tc)
            needConfirm = false
          }
        }
        if (needConfirm) {
          if (!this.confirm) {
            // 需确认但无确认器 → 拒绝（绝不放行危险动作）
            content = stringifyArgs({ error: 'rejected_by_confirm', reason: '该操作需确认但未装配确认器' })
            this.logger('warn', 'tool blocked', tc.name, '需确认但无 ConfirmStore')
            cb.onToolEnd?.(tc, content)
            return { role: 'tool', tool_call_id: tc.id, name: tc.name, content }
          }
          const approved = await this.confirm.request({ tool: tc.name, args: tc.arguments, ctx, notify: ctx?.notify })
          if (!approved) {
            content = stringifyArgs({ error: 'rejected_by_confirm', reason: '未获批准或超时' })
            this.logger('mark', 'tool rejected', tc.name, '未获批准/超时')
            cb.onToolEnd?.(tc, content)
            return { role: 'tool', tool_call_id: tc.id, name: tc.name, content }
          }
        }
      }
      // onBeforeTool 拦截（扩展点）
      let intercepted
      if (cb.onBeforeTool) intercepted = await cb.onBeforeTool(tc, execCtx)
      if (intercepted != null) {
        content = typeof intercepted === 'string' ? intercepted : stringifyArgs(intercepted)
      } else {
        try {
          const raw = await tool.execute(tc.arguments, ctx || execCtx)
          content = typeof raw === 'string' ? raw : stringifyArgs(raw)
        } catch (e) {
          // 错误日志已由 AOP 切面打印；这里归一为 {error} 结果供模型下一轮重试
          content = stringifyArgs({ error: e?.message || String(e) })
        }
      }
    }
    cb.onToolEnd?.(tc, content)
    return { role: 'tool', tool_call_id: tc.id, name: tc.name, content: this._capToolResult(content) }
  }

  /** 工具结果字符封顶：超长截断并附标记，防巨型 JSON 膨胀上下文 */
  _capToolResult(content) {
    const max = this.maxToolResultChars
    if (!max || typeof content !== 'string' || content.length <= max) return content
    return content.slice(0, max) + `\n…(已截断，原文 ${content.length} 字符；如需完整结果请缩小查询范围)`
  }
}

export { ExecutionContext } from './tools/context.js'
export { estimateMessages } from './messages.js'
