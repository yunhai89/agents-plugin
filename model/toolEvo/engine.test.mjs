import { initDb, closeDb } from './db.js'
import { ToolEvoRegistry } from './registry.js'
import { ToolSynthesizer } from './synthesizer.js'
import { EvolutionEngine } from './engine.js'

await initDb({ dir: '/tmp/tevo-engine-test' })
const reg = new ToolEvoRegistry({ artifactsDir: '/tmp/tevo-engine-test/tools' })

// mock provider：按 goal 返回合法(Tests正确→verified) / 危险(require→static reject) / 行为失败(source对但expected错→behavior reject)
const mockProvider = {
  async chat({ messages }) {
    const goal = messages[0].content
    if (goal.includes('系统命令')) {
      return { content: JSON.stringify({
        manifest: { name: 'run_cmd', description: '执行系统命令工具', inputSchema: { type: 'object' }, permissions: { sideEffects: ['none'], network: { mode: 'deny' } } },
        source: 'export async function run(input,ctx){const cp=require("child_process");return cp.execSync(input.cmd).toString()}',
        tests: [{ input: { cmd: 'ls' }, expected: 'a' }],
      }) }
    }
    if (goal.includes('行为失败')) {
      return { content: JSON.stringify({
        manifest: { name: 'bad_test', description: 'Tests断言错误的合法工具', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, permissions: { sideEffects: ['read'], network: { mode: 'deny' } } },
        source: 'export async function run(input,ctx){return{len:String(input.text||"").length}}',
        tests: [{ input: { text: 'abc' }, expected: { len: 999 } }], // source 返回 len:3，但 expected:999 → 行为验证失败
      }) }
    }
    return { content: JSON.stringify({
      manifest: { name: 'extract_email', description: '提取文本中所有邮箱地址', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, permissions: { sideEffects: ['read'], network: { mode: 'deny' } } },
      source: 'export async function run(input,ctx){const m=String(input.text||"").match(/[a-z0-9._%+-]+@[a-z0-9.-]+/gi)||[];return{emails:m}}',
      tests: [
        { input: { text: '联系 a@b.com' }, expected: { emails: ['a@b.com'] } },
        { input: { text: '无邮箱' }, expected: { emails: [] } },
      ],
    }) }
  },
}

const synth = new ToolSynthesizer({ provider: mockProvider, model: 'test-mock', maxRepairAttempts: 0 })
const engine = new EvolutionEngine({ synthesizer: synth, registry: reg })

const r1 = await engine.evolve({ goal: '提取文本中所有邮箱地址' })
console.log('1. 合法候选(static+behavior过):', r1.ok ? `✓ ${r1.status} (${r1.evidence.passed}/${r1.evidence.totalTests} tests, ${r1.evidence.avgMs}ms)` : '✗', r1.reason || '')

const r2 = await engine.evolve({ goal: '执行系统命令' })
console.log('2. 危险候选(require):', !r2.ok ? `✓ ${r2.status}` : '✗', String(r2.reason || '').slice(0, 50))

const r3 = await engine.evolve({ goal: '行为失败测试' })
console.log('3. 行为失败(expected错):', !r3.ok ? `✓ ${r3.status}` : '✗', String(r3.reason || '').slice(0, 50))

const versions = await reg.listVersions()
console.log(`4. 库内版本: ${versions.length} (1 verified + 2 rejected)`)
console.log('   状态分布:', versions.map((v) => v.status).join(','))

closeDb()
