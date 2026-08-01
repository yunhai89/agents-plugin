/**
 * toolEvo stable 工具隔离执行 runner（审计 §4.2 / P0-1，F 阻断级）。
 *
 * 背景：stable 进化工具原在 Bot 主进程直接 `import` 执行并传入完整 ctx（含 e/bot/fetcher）。
 * 审计探针证明 `Function('return process')().env` 可读宿主 env、`fetch(input.url)` 可联网、
 * `ctx.bot.pickGroup().sendMsg()` 可发消息——AST 门拦不住运行时动态逃逸。
 *
 * 修复：stable 改由**常驻 node 子进程**（runner-worker.mjs）执行，主进程仅经 IPC 传 {params}；
 * 子进程内构造冻结的 capabilityCtx = {now, log}，不接触宿主。env 最小化（仅 PATH/HOME），
 * 绝不透传 apiKey/proxy/cookie。AST 门（static.js）加固为快速拒绝门，真隔离靠本 runner。
 *
 * 崩溃自动重启（限频防循环）；invoke 超时 kill+重启；串行队列（toolEvo 低频）。
 */
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const WORKER = fileURLToPath(new URL('./runner-worker.mjs', import.meta.url))
const RESTART_MIN_MS = 1000 // 崩溃重启最小间隔（防循环）

export class RunnerClient {
  constructor({ logger = () => {}, timeoutMs = 5000 } = {}) {
    this.logger = logger
    this.timeoutMs = timeoutMs
    this._worker = null
    this._pending = new Map() // id → { resolve, timer }
    this._lastRestart = 0
    this._closed = false
    this._lock = Promise.resolve() // 串行队列（toolEvo 工具低频，避免 IPC id 竞争）
  }

  _spawn() {
    if (this._closed || this._worker) return
    // env 最小化：绝不透传 apiKey/proxy/cookie 等敏感变量（审计 §4.2）
    const env = { PATH: process.env.PATH || '', HOME: process.env.HOME || '' }
    const w = fork(WORKER, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    w.on('message', (msg) => {
      if (msg?.type === 'log') { this.logger('debug', '[toolEvo:runner] worker log:', ...(msg.args || [])); return }
      const p = this._pending.get(msg?.id)
      if (!p) return
      this._pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.ok) p.resolve({ ok: true, output: msg.output })
      else p.resolve({ ok: false, error: msg.error || '执行失败', errorClass: msg.errorClass })
    })
    w.on('exit', (code, signal) => {
      this.logger('warn', `[toolEvo:runner] worker 退出 code=${code} signal=${signal}`)
      this._failAll(`worker 退出（code=${code}）`)
      this._worker = null
      this._maybeRestart()
    })
    w.on('error', (e) => {
      this.logger('error', '[toolEvo:runner] worker error', e?.message || e)
      this._failAll(`worker error：${e?.message || e}`)
      this._worker = null
      this._maybeRestart()
    })
    w.stdout?.on('data', (d) => this.logger('debug', '[toolEvo:runner] stdout:', d.toString().trim()))
    w.stderr?.on('data', (d) => this.logger('warn', '[toolEvo:runner] stderr:', d.toString().trim()))
    this._worker = w
  }

  _maybeRestart() {
    if (this._closed) return
    const now = Date.now()
    if (now - this._lastRestart < RESTART_MIN_MS) return // 限频
    this._lastRestart = now
    this._spawn()
  }

  _failAll(reason) {
    for (const [id, p] of this._pending) {
      clearTimeout(p.timer)
      p.resolve({ ok: false, error: reason })
      this._pending.delete(id)
    }
  }

  _ensure() {
    if (!this._worker) this._spawn()
    return this._worker
  }

  /**
   * 调用 stable 工具（串行 + 超时 + 崩溃自愈）。
   * @returns {Promise<{ok, output?, error?, errorClass?}>}
   */
  async invoke(versionId, { artifactPath, params }, { timeoutMs } = {}) {
    if (this._closed) return { ok: false, error: 'runner 已关闭' }
    // 串行锁：避免并发 invoke 竞争 IPC id / 单 worker 消息交错
    await this._lock
    let release
    this._lock = new Promise((r) => { release = r })
    try {
      return await this._invokeOnce(artifactPath, params, timeoutMs)
    } finally {
      release()
    }
  }

  _invokeOnce(artifactPath, params, timeoutMs) {
    return new Promise((resolve) => {
      const id = randomBytes(6).toString('hex')
      const ms = Math.max(500, Number(timeoutMs) || this.timeoutMs)
      const timer = setTimeout(() => {
        this._pending.delete(id)
        this.logger('warn', `[toolEvo:runner] 调用超时(>${ms}ms)，kill+重启 worker`)
        try { this._worker?.kill('SIGKILL') } catch { /* noop */ }
        this._worker = null
        this._maybeRestart()
        resolve({ ok: false, error: `执行超时(>${ms}ms，疑似死循环/网络等待)` })
      }, ms)
      this._pending.set(id, { resolve, timer })
      const w = this._ensure()
      if (!w) {
        clearTimeout(timer); this._pending.delete(id)
        resolve({ ok: false, error: 'worker 启动失败' })
        return
      }
      try {
        w.send({ id, artifactPath, params })
      } catch (e) {
        clearTimeout(timer); this._pending.delete(id)
        resolve({ ok: false, error: 'IPC 发送失败：' + (e?.message || e) })
      }
    })
  }

  async stop() {
    this._closed = true
    this._failAll('runner 关闭')
    if (this._worker) { try { this._worker.kill() } catch { /* noop */ } this._worker = null }
  }
}

export default RunnerClient
