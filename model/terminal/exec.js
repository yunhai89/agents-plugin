/**
 * 终端执行能力 —— 在主机上执行 shell 命令。
 *
 * 安全模型（纵深防御，全部在代码层，不依赖 agent 自觉）：
 *   1. RBAC：category=system，非主人直接拒（policy 层 + 工具层双重）
 *   2. 审批分级（meta.shouldConfirm，移植 OpenClaw allowlist 自动放行语义）：
 *      - 命中黑名单 → 不自动放行（走主人 #确认，execute 里仍硬拦）
 *      - 含重定向/命令替换(><`$()) → 不自动放行（防写入/注入）
 *      - 全部管道/链式段都命中 allowlist（默认只读安全命令集）→ 免审批直跑
 *      - 其余未知命令 → 走主人 #确认/#拒绝
 *   3. 黑名单：即使已确认，匹配 blocklist 正则的命令仍拦截（如 rm -rf /）
 *
 * runShell 为纯执行函数（带超时、输出截断、退出码），terminal 工具在其上加安全门。
 */

import { spawn } from 'node:child_process'

function trunc(s, max) {
  const t = String(s == null ? '' : s)
  if (t.length <= max) return t
  return t.slice(0, max) + `\n…[已截断，共 ${t.length} 字符]`
}

/** auto 模式：检测命令是否需要联网（pip/npm/curl/git clone/...） */
const NET_CMDS = /\b(pip3?|pipx|npm|npx|yarn|pnpm|curl|wget|apt|apt-get|pacman|yay|git\s+clone|go\s+get|cargo|rustup|docker\s+pull|conda|brew)\b/
function needsNetwork(cmd) { return NET_CMDS.test(String(cmd || '')) }

/**
 * 在 Docker 沙盒里执行 shell 命令（即焚容器，默认无网 + tmpfs + 只读根，确保主机安全）。
 * @param {string} command
 * @param {object} opts { cwd?, timeout?(秒,默认60,上限600), maxOutput?(默认8000), terminal?={image,network,mounts} }
 * @returns {Promise<{ok, exitCode, stdout, stderr, duration, signal?, timedOut?}>}
 */
export async function runShell(command, { cwd, timeout = 60, maxOutput = 8000, terminal = {} } = {}) {
  const cmd = String(command || '')
  const seconds = Math.min(Math.max(1, Number(timeout) || 60), 600)
  const ms = seconds * 1000
  const image = terminal.image || 'archlinux:latest'
  const network = terminal.network || 'none' // none | auto | host
  const mounts = Array.isArray(terminal.mounts) ? terminal.mounts : (terminal.mounts ? String(terminal.mounts).split(',').map((s) => s.trim()).filter(Boolean) : [])
  const netFlag = network === 'host' ? '--network=host'
    : (network === 'auto' && needsNetwork(cmd)) ? '--network=host'
    : '--network=none'
  const args = ['run', '--rm',
    netFlag,
    '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
    '--read-only', '--tmpfs', '/workspace:rw,size=64m', '--tmpfs', '/tmp:rw,size=64m',
    ...mounts.flatMap((m) => ['-v', String(m)]),
    '-w', cwd || '/workspace',
    image, 'sh', '-c', cmd,
  ]
  const t0 = Date.now()
  return new Promise((resolve) => {
    let stdout = '', stderr = ''
    let timer = null
    let proc
    const finish = (r) => { if (timer) clearTimeout(timer); resolve(r) }
    try {
      proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return finish({ ok: false, stderr: trunc(String(e), maxOutput), duration: Date.now() - t0 })
    }
    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* noop */ }
      finish({ ok: false, exitCode: null, signal: 'SIGKILL', stdout: trunc(stdout, maxOutput), stderr: trunc(stderr, maxOutput), duration: Date.now() - t0, timedOut: true })
    }, ms)
    proc.on('error', (e) => {
      // docker 未装(ENOENT) 等 → 不降级主机执行
      const missing = /ENOENT|not found|spawn/i.test(e?.message || '')
      finish({ ok: false, stderr: trunc(stderr + `\n${e?.message || e}` + (missing ? '\ndocker 不可用（terminal 沙盒需 docker，不降级主机执行）' : ''), maxOutput), duration: Date.now() - t0 })
    })
    proc.on('close', (code) => finish({ ok: code === 0, exitCode: code, stdout: trunc(stdout, maxOutput), stderr: trunc(stderr, maxOutput), duration: Date.now() - t0 }))
  })
}

/** 默认安全黑名单（即使主人确认也拦截）；可在 config.terminal.blocklist 覆盖/追加 */
export const DEFAULT_BLOCKLIST = [
  'rm\\s+(-[a-z]*r[a-z]*f|[a-z]*-r[a-z]*f)', // rm -rf / rm -fr / rm -rfv 等（拦任何 rm 带 r+f flags，不管目标路径/通配符）
  'rm\\s+.*-rf', // 兜底：rm xxx -rf（flags 在后面）
  'mkfs\\.?[a-z0-9]*\\s+/dev/', // 格式化设备
  'dd\\s+.*of=/dev/', // dd 写设备
  ':\\(\\)\\s*\\{.*\\}\\s*;\\s*:', // fork bomb
  'shutdown|reboot|halt|poweroff', // 关机重启
  'chmod\\s+-R?\\s*000\\s+/', // 去除根权限
  '>/dev/sda', // 直接写设备
  'mv\\s+/.+\\s+/dev/null', // mv 到 /dev/null
]

/**
 * 默认 allowlist（只读安全命令；命中且无重定向/替换时免审批）。
 * 为正则字符串数组，按命令「前缀」匹配。保守集合：仅查询/只读类。
 * config.terminal.allowlist 非空则整体替换本默认集。
 */
export const DEFAULT_ALLOWLIST = [
  '^ls(\\s|$)', '^ll(\\s|$)', '^pwd\\s*$', '^whoami\\s*$', '^id(\\s|$)', '^date(\\s|$)',
  '^uname(\\s|$)', '^uptime\\s*$', '^echo\\s', '^printf\\s', '^wc\\s', '^file\\s', '^stat\\s',
  '^which\\s', '^whereis\\s', '^head\\s', '^tail\\s', '^cat\\s', '^grep\\s', '^egrep\\s',
  '^fgrep\\s', '^rg\\s', '^find\\s', '^du\\s', '^df\\s', '^free\\s*$', '^ps(\\s|$)',
  '^env\\s*$', '^printenv(\\s|$)', '^jq\\s',
  // git 只读子命令（push/reset/clean 等写操作不在此列 → 走确认）
  '^git\\s+status\\b', '^git\\s+log\\b', '^git\\s+diff\\b', '^git\\s+show\\b',
  '^git\\s+branch\\b', '^git\\s+remote\\b', '^git\\s+config\\s+--get\\b', '^git\\s+blame\\b',
  // 版本查询
  '^node\\s+--version\\b', '^node\\s+-v\\b', '^npm\\s+list\\b', '^npm\\s+view\\b',
  '^npm\\s+-v\\b', '^pnpm\\s+-v\\b', '^yarn\\s+-v\\b', '^pip3?\\s+list\\b', '^pip3?\\s+show\\b',
  '^python3?\\s+--version\\b', '^go\\s+version\\b', '^rustc\\s+--version\\b', '^cargo\\s+--version\\b',
]

/** 任一正则命中 → true */
export function matchesAny(cmd, patterns) {
  const list = Array.isArray(patterns) ? patterns : []
  for (const re of list) {
    try {
      if (new RegExp(re).test(cmd)) return true
    } catch { /* 无效正则跳过 */ }
  }
  return false
}

/** 含重定向/命令替换 → 视为非只读（保守不自动放行） */
function hasWriteOrSubst(cmd) {
  return /(>>|>|<|`\$\(|\$\()/.test(cmd) || /`/.test(cmd)
}

/** 拆分管道 / 链式 / 换行为独立段（保守：引号内的分隔符也会被切，至多多走确认，安全） */
function splitSegments(cmd) {
  return String(cmd || '')
    .split(/\s*(?:\|\||&&|;|\||\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * terminal 工具（系统级；allowlist 命中免审批，其余需主人 #确认/#拒绝）。
 * ctx.terminal = { cwd?, maxTimeout?, blocklist?: string[], allowlist?: string[] }
 */
export function makeTerminalTool() {
  return {
    name: 'terminal',
    description: '在主机执行终端(shell)命令。只读安全命令（ls/cat/grep/git status 等，见 allowlist）免审批直接执行；写操作/未知命令需主人 #确认/#拒绝（框架强制，不可绕过）；灾难性命令（rm -rf / 等）黑名单硬拦。用于安装软件、文件操作、运行脚本等。注意：不要用终端查看插件自身结构（技能/工具/配置等已在系统提示中列出）。返回 exitCode/stdout/stderr。',
    category: 'system',
    meta: {
      interactive: true,
      alwaysConfirm: true,
      dangerous: true,
      // 按命令入参否决审批：allowlist 全段命中且无重定向/替换 → 免审批；否则走确认
      async shouldConfirm(args, ctx) {
        const cmd = String(args?.command || '').trim()
        if (!cmd) return true
        const cfg = ctx?.terminal || {}
        const blocklist = Array.isArray(cfg.blocklist) ? cfg.blocklist : DEFAULT_BLOCKLIST
        if (matchesAny(cmd, blocklist)) return true // 黑名单 → 不自动放行
        if (hasWriteOrSubst(cmd)) return true // 重定向/替换 → 不自动放行
        const allowlist = Array.isArray(cfg.allowlist) && cfg.allowlist.length ? cfg.allowlist : DEFAULT_ALLOWLIST
        const segs = splitSegments(cmd)
        if (segs.length && segs.every((seg) => matchesAny(seg, allowlist))) return false // 全安全段 → 免审
        return true
      },
    },
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令（支持管道 | 与重定向 >）' },
        cwd: { type: 'string', description: '工作目录（可选，默认 Yunzai 根目录）' },
        timeout: { type: 'integer', description: '超时秒数（默认 60，上限 600）' },
      },
      required: ['command'],
    },
    async execute(params = {}, ctx) {
      const cfg = ctx?.terminal || {}
      const cmd = String(params.command || '').trim()
      if (!cmd) return { error: '空命令' }
      // 工具层保险：仅主人（即便 policy 漏配）
      if (!ctx?.isMaster) return { error: '仅主人可用 terminal' }
      // 黑名单（代码层，已确认也拦）
      const blocklist = Array.isArray(cfg.blocklist) ? cfg.blocklist : DEFAULT_BLOCKLIST
      if (matchesAny(cmd, blocklist)) return { error: `命令被安全策略拦截（黑名单）` }
      const res = await runShell(cmd, {
        cwd: params.cwd || cfg.cwd || undefined,
        timeout: Math.min(Number(params.timeout) || cfg.maxTimeout || 60, cfg.maxTimeout || 600),
        terminal: { image: cfg.image, network: cfg.network, mounts: cfg.mounts },
      })
      return { command: cmd, ...res }
    },
  }
}
