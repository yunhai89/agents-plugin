import { runCandidate } from './sandbox.js'
import { verifyBehavior } from './verifier/behavior.js'

const src = 'export async function run(input,ctx){const m=String(input.text||"").match(/[a-z0-9._%+-]+@[a-z0-9.-]+/gi)||[];return{emails:m}}'

// 1. runCandidate 合法
const r1 = await runCandidate({ source: src, input: { text: '联系 a@b.com 或 c@d.com' }, timeoutMs: 3000 })
console.log('1. runCandidate 合法:', r1.ok, JSON.stringify(r1.output))

// 2. 死循环超时
const r2 = await runCandidate({ source: 'export async function run(input,ctx){while(true){}return 1}', input: {}, timeoutMs: 1000 })
console.log('2. 死循环超时:', r2.timedOut, '→', String(r2.error).slice(0, 40))

// 3. 抛错
const r3 = await runCandidate({ source: 'export async function run(input,ctx){throw new Error("爆炸")}', input: {}, timeoutMs: 1500 })
console.log('3. 抛错:', !r3.ok, r3.error, r3.errorClass ? '(' + r3.errorClass + ')' : '')

// 4. verifyBehavior 全过
const vb1 = await verifyBehavior({
  source: src,
  tests: [
    { name: '单邮箱', input: { text: 'a@b.com' }, expected: { emails: ['a@b.com'] } },
    { name: '无邮箱', input: { text: '无邮箱文本' }, expected: { emails: [] } },
    { name: '多邮箱', input: { text: 'x@y.com z@w.org' }, expected: { emails: ['x@y.com', 'z@w.org'] } },
  ],
  timeoutMs: 2000,
})
console.log('4. verifyBehavior 全过:', vb1.passed, '| evidence:', JSON.stringify(vb1.evidence))

// 5. 断言失败（输出 ≠ 期望）
const vb2 = await verifyBehavior({ source: src, tests: [{ input: { text: 'a@b.com' }, expected: { emails: ['wrong'] } }], timeoutMs: 2000 })
console.log('5. 断言失败:', !vb2.passed, '→', vb2.results[0].reason.slice(0, 60))
