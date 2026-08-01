/**
 * 离线测试运行器（审计 §8 P1）：递归发现并跑 model 下 test.mjs 与 .test.mjs，汇总通过/失败。
 *
 * 设计：
 *  - 每个测试文件独立子进程跑（互不影响，单文件崩溃不拖垮整体）；
 *  - 解析其末尾「通过 N，失败 M」汇总行（中文）计数；无汇总行的按 exit code 兜底；
 *  - 不联网、不依赖 API Key；依赖 docker 的测试应自身 graceful skip（见 terminal/test.mjs）。
 *
 * 运行：npm test  或  node scripts/run-tests.mjs
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'temp', 'resources', 'web'])

function find(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) find(p, out)
    else if ((name === 'test.mjs' || name.endsWith('.test.mjs')) && !name.startsWith('_')) out.push(p)
  }
}

const tests = []
find(join(root, 'model'), tests)
tests.sort()

let passFiles = 0
let failFiles = 0
const reSummary = /通过\s*(\d+)\s*[，,]\s*失败\s*(\d+)/

for (const t of tests) {
  const r = spawnSync(process.execPath, [t], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const out = (r.stdout || '') + (r.stderr || '')
  const m = out.match(reSummary)
  const failedCount = m ? Number(m[2]) : (r.status === 0 ? 0 : 1)
  const rel = t.replace(root, '')
  if (r.status === 0 && failedCount === 0) {
    passFiles++
    const total = m ? Number(m[1]) + Number(m[2]) : '?'
    console.log(`  ✓ ${rel}  (${m ? `${m[1]} 断言` : 'ok'})`)
  } else {
    failFiles++
    console.log(`  ✗ ${rel}  (exit ${r.status}, 失败 ${failedCount})`)
    console.log(out.split('\n').filter((l) => /✗|FAIL|THROW|Error|通过.*失败/.test(l)).slice(-8).map((l) => '      ' + l).join('\n'))
  }
}

console.log(`\n========================================`)
console.log(`模块文件 通过 ${passFiles}，失败 ${failFiles}（共 ${tests.length}）`)
console.log(`========================================`)
process.exit(failFiles > 0 ? 1 : 0)
