/**
 * 工具开发 SDK 自检 —— defineTool/defineToolPack/param/loader。
 * 运行：node model/toolkit/test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  defineTool, defineToolPack, param, ok, fail,
  getGroup, loadToolPacks,
} from './index.js'

// 动态解析 toolkit 入口（原硬编码 /root/agents-plugin 绝对路径，CI 路径不同会 import 失败）
const TK_URL = new URL('./index.js', import.meta.url).href

let passed = 0
let failed = 0
function okf(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
function eq(a, b, m) { const s = JSON.stringify(a) === JSON.stringify(b); okf(s, `${m}${s ? '' : `  (got ${JSON.stringify(a)})`}`) }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e); console.error(e?.stack) } }

// ---------- 1. defineTool 校验 ----------
await test('defineTool：校验 name/execute', async () => {
  const t = defineTool({ name: 't1', execute: async () => 'x' })
  eq(t.name, 't1', 'name')
  eq(t.category, 'query', '默认 category=query')
  eq(t.parameters.type, 'object', '默认 parameters')
  let threw = false
  try { defineTool({}) } catch { threw = true }
  okf(threw, '缺 name 抛错')
  let threw2 = false
  try { defineTool({ name: 'x' }) } catch { threw2 = true }
  okf(threw2, '缺 execute 抛错')
})

// ---------- 2. defineToolPack 前缀 ----------
await test('defineToolPack：命名空间前缀', async () => {
  const pack = defineToolPack({
    name: 'my',
    tools: [defineTool({ name: 'echo', execute: async () => '' }), defineTool({ name: 'my__dup', execute: async () => '' })],
  })
  const tools = pack.resolve({})
  eq(tools[0].name, 'my__echo', '自动加前缀')
  eq(tools[1].name, 'my__dup', '已有前缀不重复')
  eq(pack.version, '1.0.0', '默认版本')

  const pack2 = defineToolPack({ name: 'np', prefix: false, tools: [defineTool({ name: 'raw', execute: async () => '' })] })
  eq(pack2.resolve({})[0].name, 'raw', 'prefix:false 不加前缀')

  // 工厂
  const pack3 = defineToolPack({ name: 'fac', factory: (ctx) => [defineTool({ name: 'greet', execute: async () => ctx.user || '' })] })
  eq(pack3.resolve({ user: 'Tom' })[0].name, 'fac__greet', '工厂工具也加前缀')
})

// ---------- 3. param 辅助 ----------
await test('param：构造 JSONSchema', async () => {
  const s = param.str('关键词')
  eq(s, { type: 'string', description: '关键词' }, 'str')
  const e = param.enum('级别', ['a', 'b'])
  eq(e.enum, ['a', 'b'], 'enum')
  const obj = param.object({ q: param.str('词') }, ['q'])
  eq(obj.required, ['q'], 'object.required')
  eq(obj.properties.q.type, 'string', 'object.properties')
})

// ---------- 4. 响应辅助 ----------
await test('ok / fail 响应结构', async () => {
  eq(ok('hi'), { ok: true, content: 'hi' }, 'ok 字符串')
  eq(ok({ a: 1 }), { ok: true, a: 1 }, 'ok 对象')
  eq(fail('bad'), { ok: false, error: 'bad' }, 'fail')
})

// ---------- 5. getGroup 降级 ----------
await test('getGroup：ctx.e.group / pickGroup', async () => {
  const g = getGroup({ e: { group: { getInfo: async () => ({ group_name: 'G' }) } } })
  okf(!!g, '从 e.group 取到')
  eq(getGroup({ e: {} }), null, '无群→null')
  const g2 = getGroup({ bot: { pickGroup: (id) => ({ id, tag: 'picked' }) }, e: { group_id: 123 } }, 123)
  eq(g2.id, 123, 'pickGroup 回退')
})

// ---------- 6. loader 自动加载 ----------
await test('loadToolPacks：扫描目录加载工具包', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-'))
  // pack 形态
  fs.writeFileSync(path.join(dir, 'pack-a.js'), `
    import { defineToolPack } from '${TK_URL}'
    export default defineToolPack({ name: 'a', tools: [{ name: 'foo', execute: async () => 'x' }] })
  `)
  // 数组形态
  fs.writeFileSync(path.join(dir, 'pack-b.js'), `
    export default [{ name: 'bar', execute: async () => 'y' }]
  `)
  const { packs, tools, errors } = await loadToolPacks(dir, { logger: () => {} })
  eq(errors.length, 0, '无加载错误')
  okf(packs.length === 2, '2 个包')
  const names = tools.map((t) => t.name).sort()
  eq(names, ['a__foo', 'pack-b__bar'], '工具带前缀拍平（匿名包按文件名命名空间）')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('loadToolPacks：目录不存在→空结果不报错', async () => {
  const { packs, tools, errors } = await loadToolPacks('/nonexistent/path/xyz', {})
  eq(packs.length, 0, '空 packs')
  eq(tools.length, 0, '空 tools')
  eq(errors.length, 0, '无错误')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
