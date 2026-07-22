/**
 * 终端执行能力公共出口。
 *
 * 用法（apps buildRuntime）：
 *   import { makeTerminalTool, runShell, DEFAULT_BLOCKLIST } from '../model/terminal/index.js'
 *   if (cfg.terminal?.enable) tools.register(makeTerminalTool())
 *
 * 安全：terminal 工具 category=system + meta.alwaysConfirm=true，
 * 每条命令在 Agent._executeOne 调度层强制主人确认（代码层，非 agent 自觉），
 * 且 DEFAULT_BLOCKLIST 拦截灾难性命令（即使已确认）。
 */

export { runShell, makeTerminalTool, DEFAULT_BLOCKLIST, DEFAULT_ALLOWLIST, matchesAny } from './exec.js'
