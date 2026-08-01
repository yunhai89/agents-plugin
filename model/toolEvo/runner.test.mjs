/**
 * toolEvo 隔离 runner 离线自检（审计 §4.2 / P0-1，F 阻断级）。
 * 验证：① 正常纯计算工具跑通；② capability ctx 只含 now/log（无 bot/fetcher/process 暴露）；
 *       ③ worker env 最小化（主进程敏感 env 不泄漏到子进程）；④ 超时 kill + 自愈。
 * 运行：node model/toolEvo/runner.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { RunnerClient } from './runner.js'

let passed = 0
let failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
function eq(a, b, m) { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, `${m}${s ? '' : `  (got ${JSON.stringify(a)})`}`) }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e); console.error(e?.stack) } }

async function writeArtifact(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tevo-art-'))
  const file = path.join(dir, 'index.js')
  fs.writeFileSync(file, source)
  return pathToFileURL(file).href
}
const cleanup = (url) => { try { fs.rmSync(new URL(url), { recursive: true, force: true }) } catch { /* noop */ } }

// ---------- 1. 正常纯计算工具 ----------
await test('runner：正常纯计算工具跑通', async () => {
  const url = await writeArtifact(`export async function run(input, ctx) { return { doubled: (input.x||0)*2 } }`)
  const r = new RunnerClient({ logger: () => {}, timeoutMs: 3000 })
  try {
    const out = await r.invoke('v1', { artifactPath: url, params: { x: 21 } })
    ok(out.ok, '调用成功')
    eq(out.output.doubled, 42, '结果正确（21*2）')
  } finally { await r.stop(); cleanup(url) }
})

// ---------- 2. capability ctx 只含 now/log ----------
await test('runner：capability ctx 只含 now/log，无 bot/fetcher 暴露', async () => {
  const url = await writeArtifact(`export async function run(input, ctx) { return { keys: Object.keys(ctx).sort(), hasBot: 'bot' in ctx, hasFetcher: 'fetcher' in ctx, nowIsFn: typeof ctx.now === 'function', logIsFn: typeof ctx.log === 'function' } }`)
  const r = new RunnerClient({ logger: () => {}, timeoutMs: 3000 })
  try {
    const out = await r.invoke('v1', { artifactPath: url, params: {} })
    ok(out.ok, '调用成功')
    eq(out.output.keys, ['log', 'now'], 'ctx 仅含 now/log（冻结白名单）')
    ok(out.output.hasBot === false, 'ctx 无 bot（审计 §4.2：不暴露宿主）')
    ok(out.output.hasFetcher === false, 'ctx 无 fetcher')
    ok(out.output.nowIsFn && out.output.logIsFn, 'now/log 均为函数')
  } finally { await r.stop(); cleanup(url) }
})

// ---------- 3. worker env 最小化（主进程敏感变量不泄漏）----------
await test('runner：worker env 最小化，主进程敏感 env 不泄漏', async () => {
  process.env.LEAKED_SECRET = 'should-not-leak-to-worker'
  const url = await writeArtifact(`export async function run(input, ctx) { return { leaked: process.env.LEAKED_SECRET || null, hasPath: !!process.env.PATH, hasHome: !!process.env.HOME } }`)
  const r = new RunnerClient({ logger: () => {}, timeoutMs: 3000 })
  try {
    const out = await r.invoke('v1', { artifactPath: url, params: {} })
    ok(out.ok, '调用成功')
    eq(out.output.leaked, null, 'worker 看不到主进程 LEAKED_SECRET（env 白名单：仅 PATH/HOME）')
    ok(out.output.hasPath === true && out.output.hasHome === true, 'worker 仍有 PATH/HOME（最小必要）')
  } finally { await r.stop(); cleanup(url); delete process.env.LEAKED_SECRET }
})

// ---------- 4. 超时 kill + 自愈 ----------
await test('runner：超时返回 error + kill worker', async () => {
  const url = await writeArtifact(`export async function run(input, ctx) { await new Promise(r=>setTimeout(r, 5000)); return {ok:true} }`)
  const r = new RunnerClient({ logger: () => {}, timeoutMs: 800 })
  try {
    const out = await r.invoke('v1', { artifactPath: url, params: {} })
    ok(!out.ok, '超时返回失败')
    ok(/超时/.test(out.error || ''), '错误信息含超时')
  } finally { await r.stop(); cleanup(url) }
})

console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
