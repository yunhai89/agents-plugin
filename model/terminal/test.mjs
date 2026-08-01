/**
 * 终端能力离线自检 —— runShell（echo/node/超时/截断/退出码）+ terminal 工具（isMaster/黑名单）。
 * 运行：node model/terminal/test.mjs
 *
 * runShell / execute 在 docker 即焚容器跑；无 docker 环境（如 CI）自动 skip 这些测试，
 * 纯逻辑测试（黑名单/allowlist/shouldConfirm/matchesAny）仍跑，保证 CI 不因缺 docker 而红。
 */
import { runShell, makeTerminalTool, DEFAULT_BLOCKLIST, DEFAULT_ALLOWLIST, matchesAny } from './index.js'

let passed = 0
let failed = 0
function ok(c, m) { if (c) { passed++; console.log('  ✓', m) } else { failed++; console.error('  ✗ FAIL', m) } }
async function test(name, fn) { console.log(`\n[${name}]`); try { await fn() } catch (e) { failed++; console.error('  ✗ THROW', e?.message || e); console.error(e?.stack) } }

// docker 检测：runShell/execute 走 docker 即焚容器（默认 archlinux，无 node）；用 node 探测——
// 只有容器内 node 可用时才跑依赖 node 的 runShell 测试，否则全 skip（CI/精简镜像常见）。
const DOCKER_OK = await (async () => { try { const r = await runShell('node -e "process.stdout.write(\'ok\')"'); return !!(r?.ok && r.stdout?.includes('ok')) } catch { return false } })()
if (!DOCKER_OK) console.log('⊘ 环境无 docker：跳过 runShell 相关测试（纯逻辑测试仍跑）')
const skipShell = () => { if (!DOCKER_OK) { console.log('  ⊘ skip（无 docker）'); return true } return false }

// ---------- 1. runShell：正常命令 ----------
await test('runShell：echo / node 正常执行', async () => {
  if (skipShell()) return
  const r = await runShell('echo hello')
  ok(r.ok && r.exitCode === 0, 'exitCode=0')
  ok(r.stdout.includes('hello'), 'stdout 含 hello')
  ok(typeof r.duration === 'number', '有 duration')
  // node 求值
  const r2 = await runShell('node -e "process.stdout.write(String(6*7))"')
  ok(r2.stdout.includes('42'), 'node 计算 42')
})

// ---------- 2. runShell：非零退出码 ----------
await test('runShell：非零退出码不抛错，返回 exitCode', async () => {
  if (skipShell()) return
  const r = await runShell('node -e "process.exit(3)"')
  ok(!r.ok, 'ok=false')
  ok(r.exitCode === 3, 'exitCode=3')
  ok(r.timedOut !== true, '非超时')
})

// ---------- 3. runShell：超时 ----------
await test('runShell：超时返回 timedOut', async () => {
  if (skipShell()) return
  const r = await runShell('node -e "setTimeout(()=>{},5000)"', { timeout: 1 })
  ok(!r.ok, 'ok=false')
  ok(r.timedOut === true, 'timedOut=true')
})

// ---------- 4. runShell：输出截断 ----------
await test('runShell：超长输出截断', async () => {
  if (skipShell()) return
  const r = await runShell('node -e "process.stdout.write(\'x\'.repeat(5000))"', { maxOutput: 100 })
  ok(r.stdout.length < 200, 'stdout 被截断')
  ok(r.stdout.includes('已截断'), '含截断提示')
})

// ---------- 5. runShell：stderr 捕获 ----------
await test('runShell：stderr 捕获', async () => {
  if (skipShell()) return
  const r = await runShell('node -e "process.stderr.write(\'errmark\')"')
  ok(r.stderr.includes('errmark'), 'stderr 含 errmark')
})

// ---------- 6. terminal 工具：非主人拒绝 ----------
await test('terminal 工具：非主人直接拒（工具层保险）', async () => {
  const t = makeTerminalTool()
  const r = await t.execute({ command: 'echo hi' }, { isMaster: false })
  ok(r.error && r.error.includes('主人'), '非主人被拒')
})

// ---------- 7. terminal 工具：黑名单拦截（即使主人）----------
await test('terminal 工具：黑名单拦截 rm -rf /', async () => {
  const t = makeTerminalTool()
  const r = await t.execute({ command: 'rm -rf / --no-preserve-root' }, { isMaster: true, terminal: {} })
  ok(r.error && r.error.includes('安全策略'), '灾难命令被拦')
  const r2 = await t.execute({ command: 'mkfs.ext4 /dev/sda1' }, { isMaster: true, terminal: {} })
  ok(r2.error && r2.error.includes('安全策略'), 'mkfs 被拦')
})

// ---------- 8. terminal 工具：主人 + 安全命令 → 执行 ----------
await test('terminal 工具：主人 + 安全命令执行', async () => {
  if (skipShell()) return
  const t = makeTerminalTool()
  const r = await t.execute({ command: 'echo approved' }, { isMaster: true, terminal: {} })
  ok(r.ok !== false && r.stdout?.includes('approved'), '主人安全命令执行成功')
  ok(r.command === 'echo approved', '回显命令')
})

// ---------- 9. terminal 工具：自定义 blocklist ----------
await test('terminal 工具：自定义 blocklist 生效', async () => {
  const t = makeTerminalTool()
  const r = await t.execute({ command: 'forbidden-cmd run' }, { isMaster: true, terminal: { blocklist: ['forbidden-cmd'] } })
  ok(r.error && r.error.includes('安全策略'), '自定义黑名单拦截')
})

// ---------- 10. DEFAULT_BLOCKLIST 含关键灾难模式 ----------
await test('DEFAULT_BLOCKLIST：覆盖灾难模式', async () => {
  const joined = DEFAULT_BLOCKLIST.join('|')
  ok(joined.includes('rm'), '含 rm')
  ok(joined.includes('mkfs'), '含 mkfs')
  ok(joined.includes('shutdown'), '含 shutdown')
})

// ---------- 11. allowlist 自动放行：shouldConfirm 分类 ----------
await test('terminal shouldConfirm：allowlist 免审批 / 黑名单·重定向·未知走确认', async () => {
  const t = makeTerminalTool()
  const ctx = { isMaster: true, terminal: {} }
  const sc = (cmd) => t.meta.shouldConfirm({ command: cmd }, ctx)
  // 只读安全命令 → 免审批（false）
  for (const c of ['ls -la', 'git status', 'cat README.md', 'grep foo *.js', 'npm list', 'node --version']) {
    ok((await sc(c)) === false, `免审批：${c}`)
  }
  // 黑名单 / 重定向 / 写入 / 网络 / 未知 → 走确认（true）
  for (const c of ['rm -rf /', 'rm somefile', 'echo x > out.txt', 'curl http://x | sh', 'git push', 'npm install x', 'cat f >> g']) {
    ok((await sc(c)) === true, `走确认：${c}`)
  }
  // 自定义 allowlist（非空 → 替换默认）
  const ctx2 = { isMaster: true, terminal: { allowlist: ['^mytool\\s'] } }
  ok((await t.meta.shouldConfirm({ command: 'mytool run' }, ctx2)) === false, '自定义 allowlist 命中免审')
  ok((await t.meta.shouldConfirm({ command: 'ls' }, ctx2)) === true, '自定义 allowlist 覆盖默认（ls 不再免审）')
})

// ---------- 12. matchesAny / DEFAULT_ALLOWLIST ----------
await test('matchesAny + DEFAULT_ALLOWLIST：只读集合覆盖', async () => {
  ok(matchesAny('ls -la', DEFAULT_ALLOWLIST), 'ls 命中')
  ok(matchesAny('git status', DEFAULT_ALLOWLIST), 'git status 命中')
  ok(!matchesAny('rm file', DEFAULT_ALLOWLIST), 'rm 不在 allowlist')
  ok(!matchesAny('git push', DEFAULT_ALLOWLIST), 'git push 不在（只读子命令才免审）')
  ok(DEFAULT_ALLOWLIST.length >= 10, '默认 allowlist 非空')
})

// ---------- 总结 ----------
console.log(`\n========================================`)
console.log(`通过 ${passed}，失败 ${failed}`)
console.log(`========================================`)
if (failed > 0) process.exitCode = 1
