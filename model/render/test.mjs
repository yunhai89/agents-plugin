/**
 * model/render 离线自检 —— 主题 / buildHtml / markdown 渲染（含降级路径）。
 * 运行：node model/render/test.mjs
 * 注：完整 highlight 路径需 marked/highlight.js（npm install）；未装时自动走降级，
 *     本测试主要覆盖降级路径 + 结构正确性。
 */
import { THEME_CSS, buildHtml, mdToHtml, fallbackMd, isHighlightAvailable } from './index.js'

let passed = 0
let failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e) } }

await test('THEME_CSS：浅色主题关键样式', async () => {
  ok(THEME_CSS.includes('#container'), '含 #container 样式')
  ok(THEME_CSS.includes('.hljs-keyword'), '含代码高亮 token 样式')
  ok(!/#[0-9a-fA-F]{6}\s*;?\s*\/\s*\*.*暗/.test(THEME_CSS), '主题为浅色基调')
  ok(THEME_CSS.includes('background: #ffffff') || THEME_CSS.includes('background:#ffffff'), '卡片白底')
})

await test('buildHtml：#container 卡片 + 标题/页脚', async () => {
  const html = buildHtml({ title: '帮助', subtitle: '子标题', bodyHtml: '<p>hi</p>', footer: 'v1' })
  ok(html.includes('<div id="container"'), '含 #container 卡片')
  ok(html.includes('class="head"') && html.includes('帮助'), '含标题区')
  ok(html.includes('class="footer"') && html.includes('v1'), '含页脚')
  ok(html.includes('<style>') && html.includes('.hljs'), '内联主题样式')
})

await test('fallbackMd：标题/列表/代码块/粗体', async () => {
  const md = '# 标题\n\n**粗** 和 `code` 与 [链](http://x)\n\n- 项一\n- 项二\n\n```python\nprint(1)\n```'
  const html = fallbackMd(md)
  ok(html.includes('<h1>') && html.includes('标题'), 'h1')
  ok(html.includes('<strong>粗</strong>'), '粗体')
  ok(html.includes('<code>code</code>'), '行内 code')
  ok(html.includes('<a href="http://x">链</a>'), '链接')
  ok(html.includes('<ul>') && html.includes('<li>项一</li>'), '无序列表')
  ok(html.includes('<pre data-lang="python">'), '代码块带 data-lang')
  ok(html.includes('print(1)'), '代码块保留内容（已转义）')
})

await test('fallbackMd：转义防注入', async () => {
  const html = fallbackMd('<script>x</script>')
  ok(!html.includes('<script>'), '原始标签被转义')
  ok(html.includes('&lt;script&gt;'), '转义正确')
})

await test('mdToHtml：返回 HTML 字符串（降级或完整）', async () => {
  const html = await mdToHtml('# Hi\n\n- a\n- b')
  ok(typeof html === 'string' && html.length > 0, '返回非空 HTML')
  ok(/h1|ul/.test(html), '含结构标签')
})

await test('isHighlightAvailable：缺依赖时为 false（dev 环境）', async () => {
  // dev 环境未 npm install，应为 false（降级）。装了依赖后变 true。
  console.log('  (当前 highlight 可用:', isHighlightAvailable(), ')')
  ok(typeof isHighlightAvailable() === 'boolean', '返回布尔')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
