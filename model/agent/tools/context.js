/**
 * ExecutionContext —— 工具执行时拿到的上下文。
 * 工具通过 ctx 访问 agent、task_id、消息快照、取消信号与日志，以及自定义 props。
 */
export class ExecutionContext {
  constructor({ agent, taskId, messages, signal, logger, props }) {
    this.agent = agent
    this.taskId = taskId
    this.messages = messages
    this.signal = signal || null
    this.logger = logger || (() => {})
    this.props = props || {}
  }

  /** 当前会话的声明式记忆（若 Agent 装配了 MemoryStore） */
  get memory() {
    return this.agent?.memory || null
  }

  /** 便捷：以额外 props 派生一个子上下文 */
  child(props = {}) {
    return new ExecutionContext({
      agent: this.agent,
      taskId: this.taskId,
      messages: this.messages,
      signal: this.signal,
      logger: this.logger,
      props: { ...this.props, ...props },
    })
  }
}
