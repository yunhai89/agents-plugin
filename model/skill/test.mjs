/**
 * Skill（说明书）离线自检 —— defineSkill / SkillRegistry.match+assemble / loadSkillPack(.md/.js)。
 * 运行：node model/skill/test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineSkill, SkillRegistry, loadSkillPack, normalizeWhen, parseSkillMd, formatCatalog, makeSkillTool } from './index.js'

let passed = 0
let failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
function eq(a, b, m) { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, `${m}${s ? '' : `  (got ${JSON.stringify(a)})`}`) }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e); console.error(e?.stack) } }

// ---------- 1. defineSkill：说明书契约（name + body 必填，无 execute） ----------
await test('defineSkill：契约校验', async () => {
  const s = defineSkill({ name: 'demo', description: 'd', when: ['x', 'y'], body: '怎么做' })
  eq(s.name, 'demo', 'name')
  ok(s.when.keywords.includes('x'), 'when 关键词')
  ok(!('execute' in s), '说明书不含 execute（与工具的根本区别）')
  let threw = false
  try { defineSkill({ name: 'a' }) } catch { threw = true }
  ok(threw, '缺 body 抛错')
  let threw2 = false
  try { defineSkill({ body: 'x' }) } catch { threw2 = true }
  ok(threw2, '缺 name 抛错')
})

// ---------- 2. normalizeWhen：多种形态 ----------
await test('normalizeWhen：string/array/regex/object/always', async () => {
  eq(normalizeWhen('猫').keywords, ['猫'], '字符串→关键词')
  eq(normalizeWhen(['a', 'b']).keywords, ['a', 'b'], '数组→关键词')
  ok(normalizeWhen(/x/).regex.length === 1, '正则')
  eq(normalizeWhen(undefined, true).always, true, 'always=true')
  eq(normalizeWhen('always').always, true, '字符串 always')
  const o = normalizeWhen({ keywords: ['k'], regex: [/r/], always: false })
  eq(o.keywords, ['k'], 'object.keywords')
  eq(o.regex.length, 1, 'object.regex')
})

// ---------- 3. SkillRegistry：变参注册 + match + assemble ----------
await test('SkillRegistry：match 命中 + assemble 拼装', async () => {
  const reg = new SkillRegistry().register(
    { name: 'a', when: ['猫', '喵'], body: 'A 指令' },
    { name: 'b', when: [/^研究/], body: 'B 指令' },
    { name: 'c', always: true, body: 'C 常驻' },
    { name: 'd', when: ['不相关的词'], body: 'D' },
  )
  const m = reg.match({ input: '我家猫一直喵喵叫' })
  const names = m.map((s) => s.name).sort()
  eq(names, ['a', 'c'], '命中 a(关键词) 与 c(常驻)，不含 b/d')
  const asm = reg.assemble(reg.match({ input: '研究 AI' }))
  ok(asm.includes('技能：b') && asm.includes('研究') === false || asm.includes('B 指令'), 'b 被正则命中')
  const txt = reg.pick({ input: '猫' })
  ok(txt.includes('技能：a') && txt.includes('A 指令'), 'pick 一步到位')
})

// ---------- 4. parseSkillMd：frontmatter 解析 ----------
await test('parseSkillMd：解析 frontmatter + 正文', async () => {
  const md = `---
name: my-skill
description: 测试技能
when: 功能, MCP, 能力
priority: 5
---
# 正文
按 状态→现状→出路 回答。`
  const s = parseSkillMd(md, 'fallback')
  eq(s.name, 'my-skill', 'name')
  eq(s.description, '测试技能', 'description')
  eq(s.when, ['功能', 'MCP', '能力'], 'when 切分数组')
  eq(s.priority, 5, 'priority')
  ok(s.body.includes('状态→现状→出路'), '正文保留')
  // 无 frontmatter
  const s2 = parseSkillMd('纯正文', 'fb')
  eq(s2.name, 'fb', '无 frontmatter 用 fallback 名')
  ok(s2.body.includes('纯正文'), '整篇当 body')
})

// ---------- 5. loadSkillPack：.md + .js 混合加载 ----------
await test('loadSkillPack：扫描 .md/.js 加载说明书', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'))
  fs.writeFileSync(path.join(dir, 'a.md'), `---
name: skill-a
when: [猫, 喵]
---
A 指令`)
  fs.writeFileSync(path.join(dir, 'b.js'), `
export default { name: 'skill-b', when: '研究', body: 'B 指令' }
`)
  const skills = await loadSkillPack(dir, { logger: () => {} })
  eq(skills.map((s) => s.name).sort(), ['skill-a', 'skill-b'], '加载 2 个说明书')
  const reg = new SkillRegistry().register(...skills)
  ok(reg.match({ input: '猫叫' }).map((s) => s.name).includes('skill-a'), '.md 的 when 生效')
  ok(reg.match({ input: '研究 X' }).map((s) => s.name).includes('skill-b'), '.js 的 when 生效')
  fs.rmSync(dir, { recursive: true, force: true })
})

// ---------- 6. 加载真实 skills/ 目录 ----------
await test('loadSkillPack：加载项目 skills/ 真实说明书', async () => {
  const skills = await loadSkillPack(path.resolve('skills'), { logger: () => {} })
  const names = skills.map((s) => s.name).sort()
  console.log('  已加载:', names.join(', '))
  ok(names.includes('capability-inquiry'), '含 capability-inquiry')
  const reg = new SkillRegistry().register(...skills)
  // 模拟用户的 MCP 提问 → 命中 capability-inquiry
  const hit = reg.match({ input: '你有 MCP 功能吗' }).map((s) => s.name)
  ok(hit.includes('capability-inquiry'), '问 MCP 命中 capability-inquiry')
  const txt = reg.pick({ input: '你有 MCP 功能吗' })
  ok(txt.includes('状态') && txt.includes('出路'), '说明书含 状态→现状→出路 结构')
})

// ---------- 7. formatCatalog：<available_skills> 目录块 ----------
await test('formatCatalog：编译 <available_skills> 目录', async () => {
  const reg = new SkillRegistry().register(
    { name: 'group-admin', description: '群管理：禁言/踢人/头衔', body: 'x' },
    { name: 'research', description: '深度调研主题', body: 'y' },
  )
  const cat = reg.catalog()
  ok(cat.includes('<available_skills>') && cat.includes('</available_skills>'), '含目录标签')
  ok(cat.includes('<name>group-admin</name>'), '含 name')
  ok(cat.includes('<description>群管理：禁言/踢人/头衔</description>'), '含 description')
  ok(cat.includes('skill` 工具'), '指引模型调用 skill 工具')
  ok(!cat.includes('x') && !cat.includes('y'), '目录不含正文 body（渐进式披露）')
  eq(formatCatalog([]), '', '空列表返回空串')
})

// ---------- 8. parseSkillMd：健壮 frontmatter（引号/行内数组/多行）----------
await test('parseSkillMd：引号/行内数组/逗号 三种 when 形态', async () => {
  const md = `---
name: x
description: "含, 逗号 与：冒号的描述"
when: [禁言, 踢人, 头衔]
priority: 7
---
正文`
  const s = parseSkillMd(md, 'fb')
  eq(s.name, 'x', 'name')
  eq(s.description, '含, 逗号 与：冒号的描述', '引号内逗号/冒号不破坏解析')
  eq(s.when, ['禁言', '踢人', '头衔'], '行内数组 when')
  eq(s.priority, 7, 'priority 数值')
  // XML 特殊字符在 description 里需被 catalog 转义
  const reg = new SkillRegistry().register(s)
  ok(reg.catalog().includes('&amp;') || reg.catalog().includes('逗号'), '目录转义或保留描述')
})

await test('parseSkillMd：逗号串 when + 缺省字段兜底', async () => {
  const s = parseSkillMd(`---
name: y
when: 猫, 狗
---
b`, 'fb')
  eq(s.when, ['猫', '狗'], '逗号串切分')
  eq(s.description, '', '无 description → 空（defineSkill 会兜底）')
  eq(s.always, false, 'always 默认 false')
})

// ---------- 9. makeSkillTool：模型主动加载 skill 正文 ----------
await test('makeSkillTool：按 name 加载正文 / 未找到报错', async () => {
  const reg = new SkillRegistry().register({ name: 'group-admin', description: '群管', body: '## 群管指引\n按步骤' })
  const tool = makeSkillTool(reg)
  eq(tool.name, 'skill', '工具名 skill')
  ok(tool.parameters.required.includes('name'), '必填 name')
  eq(tool.category, 'query', '低权限门槛')
  const body = await tool.execute({ name: 'group-admin' })
  ok(String(body).includes('群管指引') && String(body).includes('技能：group-admin'), '返回正文')
  const miss = await tool.execute({ name: 'nope' })
  ok(miss && miss.error, '未找到返回 error')
  const empty = await tool.execute({})
  ok(empty && empty.error, '缺参数返回 error')
})

// ---------- 10. catalog 始终包含全部 skill（即使未命中 when）----------
await test('catalog：目录始终含全部 skill，不依赖命中', async () => {
  const reg = new SkillRegistry().register(
    { name: 'a', description: '甲', when: ['不相关词'], body: 'A' },
    { name: 'b', description: '乙', body: 'B' },
  )
  // match 依赖关键词，命中为空
  eq(reg.match({ input: '完全无关的内容' }).length, 0, 'match 未命中')
  // 但 catalog 仍列出全部
  const cat = reg.catalog()
  ok(cat.includes('<name>a</name>') && cat.includes('<name>b</name>'), '目录列出全部 skill（模型可见）')
})

// ---------- 11. 目录型技能（subdir/SKILL.md）递归加载 ----------
await test('loadSkillPack：递归发现 子目录/SKILL.md（skillhub 形态）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skilldir-'))
  fs.writeFileSync(path.join(dir, 'flat.md'), '---\nname: flat\ndescription: 扁平技能\n---\n正文')
  fs.mkdirSync(path.join(dir, 'my-pack', 'nested'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'my-pack', 'SKILL.md'), '---\nname: my-pack\ndescription: 目录型技能\n---\n# 正文')
  fs.writeFileSync(path.join(dir, 'my-pack', 'README.md'), '# 这只是说明文档') // 非 SKILL.md，不加载
  fs.writeFileSync(path.join(dir, 'my-pack', 'nested', 'SKILL.md'), '---\nname: nested-pack\ndescription: 更深层\n---\n正文')
  fs.writeFileSync(path.join(dir, '.skills_store_lock.json'), '{}') // 隐藏文件跳过
  const skills = await loadSkillPack(dir, { logger: () => {} })
  const names = skills.map((s) => s.name).sort()
  eq(names, ['flat', 'my-pack', 'nested-pack'], '加载 顶层md + 两层 SKILL.md，排除 README/隐藏')
  const reg = new SkillRegistry().register(...skills)
  ok(reg.catalog().includes('my-pack') && reg.catalog().includes('nested-pack'), '目录型技能进入 catalog')
  fs.rmSync(dir, { recursive: true, force: true })
})

await test('formatCatalog：description 过长截断', async () => {
  const reg = new SkillRegistry().register({ name: 'x', description: '一'.repeat(120), body: 'b' })
  const cat = reg.catalog()
  ok(cat.includes('…'), '超长 description 被截断(含 …)')
})

console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
