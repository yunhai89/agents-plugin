/**
 * 候选工具沙箱执行器（阶段2）。
 *
 * 安全模型（纵深）：
 *   1. 前置门：typescript AST 已禁 require/child_process/process.env/eval/动态 import/一切 import（verifier/static.js）
 *      → 候选是纯函数，无 import、不接触宿主环境；
 *   2. 执行隔离：node 子进程跑候选，超时 SIGKILL + stdout/stderr 截断（资源兜底，防死循环/大输出）。
 *
 * 第一版用 node 子进程（零 docker 镜像依赖，可靠）。若需更强隔离，可切 docker：
 *   runShell('node runner.mjs', { cwd:'/app', terminal:{ image:'node:20-alpine', network:'none', mounts:[`${bundleDir}:/app`] } })
 *   —— 候选已过 AST，子进程对"纯函数候选"足够；docker 是对完全不可信代码的加强，非必需。
 *
 * 不向子进程透传敏感 env（仅 TOOL_INPUT_JSON + 必要的 PATH）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 测试驱动：动态 import 候选 index.js 的 run，跑 input，输出 JSON 结果 */
const RUNNER = `
const inp = JSON.parse(process.env.TOOL_INPUT_JSON || '{}')
const ctx = { requestId: 'verify', now: () => new Date().toISOString(), log() {} }
import('./index.js').then(async ({ run }) => {
  if (typeof run !== 'function') return process.stdout.write(JSON.stringify({ ok: false, error: '未导出 run 函数' }))
  try { const out = await run(inp, ctx); process.stdout.write(JSON.stringify({ ok: true, output: out })) }
  catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: e?.message || String(e), errorClass: e?.name || 'Error' })) }
}).catch(e => process.stdout.write(JSON.stringify({ ok: false, error: '加载候选失败：' + (e?.message || e) })))
`

/**
 * 在隔离子进程跑一次候选。
 * @param {object} p { source, input, timeoutMs?, maxOutput? }
 * @returns {Promise<{ok, output?, error?, errorClass?, exitCode?, duration, timedOut?, stderr?}>}
 */
export async function runCandidate({ source, input, timeoutMs = 3000, maxOutput = 8192 }) {
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tevo-verify-'))
  try {
    fs.writeFileSync(path.join(bundleDir, 'index.js'), String(source || ''))
    fs.writeFileSync(path.join(bundleDir, 'runner.mjs'), RUNNER)
    const r = await new Promise((resolve) => {
      const env = { TOOL_INPUT_JSON: JSON.stringify(input ?? {}), PATH: process.env.PATH || '', HOME: process.env.HOME || '' }
      const t0 = Date.now()
      const proc = spawn(process.execPath, ['runner.mjs'], { cwd: bundleDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL') } catch { /* noop */ }
        resolve({ timedOut: true, stdout, stderr, duration: Date.now() - t0 })
      }, Math.max(500, Number(timeoutMs) || 3000))
      proc.stdout?.on('data', (d) => { stdout += d.toString() })
      proc.stderr?.on('data', (d) => { stderr += d.toString() })
      proc.on('error', (e) => { clearTimeout(timer); resolve({ spawnError: e.message, stdout, stderr, duration: Date.now() - t0 }) })
      proc.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code, stdout, stderr, duration: Date.now() - t0 }) })
    })
    if (r.timedOut) return { ok: false, error: `执行超时(>${timeoutMs}ms，疑似死循环)`, timedOut: true, duration: r.duration, stderr: r.stderr.slice(0, 512) }
    if (r.spawnError) return { ok: false, error: '子进程启动失败：' + r.spawnError, duration: r.duration }
    try {
      const out = JSON.parse(r.stdout.slice(0, maxOutput))
      return { ok: !!out.ok, output: out.output, error: out.error, errorClass: out.errorClass, exitCode: r.exitCode, duration: r.duration, stderr: r.stderr.slice(0, 512) }
    } catch {
      return { ok: false, error: '候选输出非 JSON（或未正确 return）：' + r.stdout.slice(0, 200), exitCode: r.exitCode, duration: r.duration, stderr: r.stderr.slice(0, 512) }
    }
  } finally {
    try { fs.rmSync(bundleDir, { recursive: true, force: true }) } catch { /* noop */ }
  }
}

export default { runCandidate }
