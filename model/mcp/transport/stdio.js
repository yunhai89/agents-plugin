/**
 * stdio 传输 —— spawn 子进程，换行分隔 JSON（MCP 经典本地传输）。
 * 适合连接本地 MCP 服务端（filesystem/git/sql… 以子进程形式运行）。
 */

import { spawn } from 'node:child_process'
import { BaseTransport } from './base.js'

export class StdioTransport extends BaseTransport {
  constructor({ command, args = [], env, cwd } = {}) {
    super()
    if (!command) throw new Error('StdioTransport 需要 command')
    this.command = command
    this.args = args
    this.env = env
    this.cwd = cwd
    this._proc = null
    this._buffer = ''
  }

  async start() {
    this._proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
      cwd: this.cwd,
    })
    this._proc.stdout.setEncoding('utf8')
    this._proc.stdout.on('data', (chunk) => this._onData(chunk))
    this._proc.stderr.setEncoding('utf8')
    this._proc.stderr.on('data', (chunk) => this._onLog(chunk))
    this._proc.on('error', (e) => this._onError(e))
    this._proc.on('close', (code) => this._onClose(code))
  }

  _onData(chunk) {
    this._buffer += chunk
    let i
    while ((i = this._buffer.indexOf('\n')) >= 0) {
      const line = this._buffer.slice(0, i).trim()
      this._buffer = this._buffer.slice(i + 1)
      if (!line) continue
      try {
        this._onMessage(JSON.parse(line))
      } catch (e) {
        this._onError(new Error(`stdio 解析失败: ${line}`))
      }
    }
  }

  async send(obj) {
    if (!this._proc || !this._proc.stdin.writable) throw new Error('stdio 未连接')
    this._proc.stdin.write(`${JSON.stringify(obj)}\n`)
  }

  async close() {
    try { this._proc?.stdin?.end() } catch { /* noop */ }
    try { this._proc?.kill('SIGTERM') } catch { /* noop */ }
  }
}
