/**
 * ToolEvoRegistry 版本回滚离线自检（审计 §4.1 / P0-4）。
 * 验证：① listStable 每工具只返回 active 版本；② setActiveVersion 切换 active；③ 非 stable 不可设 active。
 * 运行：node model/toolEvo/registry.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initDb, closeDb } from './db.js'
import { ToolEvoRegistry } from './registry.js'
import { makeManifest } from './manifest.js'

let passed = 0
let failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e); console.error(e?.stack) } }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tevo-reg-'))
await initDb({ dir: tmpDir })
const reg = new ToolEvoRegistry({ artifactsDir: path.join(tmpDir, 'tools') })

const mkManifest = (name, semver) => makeManifest({
  name, version: semver, description: '回滚测试工具描述',
  inputSchema: { type: 'object' }, permissions: { sideEffects: ['none'], network: { mode: 'deny' } },
})

await test('listStable：每工具只返回 active 版本（多 stable 不全返回）', async () => {
  const toolId = 'tool_rb1'
  await reg.createTool({ id: toolId, name: 'rollback_demo1', namespace: 'test' })
  const v1 = await reg.createVersion({ toolId, semver: '1.0.0', manifest: mkManifest('rollback_demo1', '1.0.0'), source: 'export async function run(){return{v:1}}', tests: [] })
  const v2 = await reg.createVersion({ toolId, semver: '2.0.0', manifest: mkManifest('rollback_demo1', '2.0.0'), source: 'export async function run(){return{v:2}}', tests: [] })
  await reg.setStatus(v1.id, 'verified'); await reg.setStatus(v1.id, 'stable') // draft→verified→stable（转移才回填 active）
  await reg.setStatus(v2.id, 'verified'); await reg.setStatus(v2.id, 'stable') // 后采纳 → active = v2
  const list = await reg.listStable()
  ok(list.length === 1, 'listStable 只返回 1 个（active，非全部 stable）')
  ok(list[0].semver === '2.0.0', 'active = v2（后采纳覆盖）')
})

await test('setActiveVersion：切换 active（回滚）', async () => {
  const tool = await reg.getByName('rollback_demo1')
  const v1 = (await reg.listVersions({ toolId: tool.id })).find((v) => v.semver === '1.0.0')
  await reg.setActiveVersion(tool.id, v1.id, { actor: 'master:test', reason: '手动回滚' })
  const list = await reg.listStable()
  ok(list.length === 1 && list[0].semver === '1.0.0', '回滚后 active = v1')
})

await test('setActiveVersion：拒绝非 stable 版本（防回滚到未验证版本）', async () => {
  const toolId = 'tool_rb2'
  await reg.createTool({ id: toolId, name: 'rollback_demo2', namespace: 'test' })
  const v = await reg.createVersion({ toolId, semver: '0.1.0', manifest: mkManifest('rollback_demo2', '0.1.0'), source: 'export async function run(){}', tests: [] })
  let threw = null
  try { await reg.setActiveVersion(toolId, v.id) } catch (e) { threw = e }
  ok(threw && /stable/.test(threw.message), 'draft 版本不可设 active（抛错含 stable）')
})

closeDb()
fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
