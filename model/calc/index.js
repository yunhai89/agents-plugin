/**
 * Python 精确计算工具（calculate）。
 *
 * 模型遇到数学/统计/大数/复杂公式/单位换算等问题时，调用本工具写 Python 代码本地执行，
 * 拿到准确数值结果，避免模型自身心算出错（大数乘除、浮点、开方、统计等极易算错）。
 *
 * 安全：在受限沙箱内执行——
 *  - 仅允许 import 白名单模块（math/statistics/decimal/fractions/itertools/json/datetime/re/cmath）
 *  - 禁用 open/exec/eval/compile/getattr 等危险内建 + 网络无关、无文件系统
 *  - 子进程隔离 + 超时（默认 10s）防死循环
 *  预导入常用数学库，用户代码直接用 math.sqrt / statistics.mean 等，用 print() 输出答案。
 *  注：非 hardened 沙箱（对象子类遍历类逃逸理论上存在），面向可信模型做数学计算；不处理不可信 prompt。
 *
 * 依赖：python3（本机/容器均需）。缺失时工具返回明确提示。
 */

import { spawn } from 'node:child_process'
import Config from '../../utils/Config.js'

/** 沙箱 wrapper（固定，以 `python3 -c` 运行；用户代码经 stdin 传入，无转义问题） */
const SANDBOX = `import sys, builtins as _B, math, statistics, decimal, fractions, itertools, json, datetime, random, re, cmath
_ALLOWED = {'math','statistics','decimal','fractions','itertools','json','datetime','random','re','cmath'}
_DANGEROUS = {'open','exec','eval','compile','exit','quit','input','breakpoint','globals','locals','vars','dir','getattr','setattr','delattr','memoryview','help','license','copyright','credits'}
_b = {k: v for k, v in _B.__dict__.items() if k not in _DANGEROUS}
_oi = _b.get('__import__')
def _si(name, *a, **k):
    root = name.split('.')[0]
    if root not in _ALLOWED:
        raise ImportError("module '%s' not allowed (calc sandbox: math/stats only)" % name)
    return _oi(name, *a, **k)
_b['__import__'] = _si
_ns = {'__builtins__': _b, 'math': math, 'statistics': statistics, 'decimal': decimal, 'fractions': fractions, 'itertools': itertools, 'json': json, 'datetime': datetime, 'random': random, 're': re, 'cmath': cmath}
exec(sys.stdin.read(), _ns)`

/**
 * 在沙箱里执行 Python 代码。
 * @returns {ok, exitCode, stdout, stderr, missing?, timedOut?}
 */
export function runPython(code, { python = 'python3', timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = ''
    let timer = null
    let proc
    const finish = (r) => { if (timer) clearTimeout(timer); resolve(r) }
    try {
      proc = spawn(python, ['-c', SANDBOX], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      return finish({ ok: false, missing: true, stderr: String(e) })
    }
    timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* noop */ } finish({ ok: false, timedOut: true, stdout, stderr }) }, timeout)
    proc.stdin?.on('error', () => { /* noop */ })
    try { proc.stdin.write(String(code || '')); proc.stdin.end() } catch { /* noop */ }
    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('error', (e) => {
      const missing = /ENOENT|not found|spawn/i.test(e?.message || '')
      finish({ ok: false, missing, stderr: stderr + `\n${e?.message || e}` })
    })
    proc.on('close', (code2) => finish({ ok: code2 === 0, exitCode: code2, stdout, stderr }))
  })
}

export const calcTool = {
  name: 'calculate',
  description: [
    '执行 Python 代码做精确数值计算（数学/统计/单位换算/大数/复杂公式/日期差/财务利率等）。',
    '何时用：需要精确数字结果、或避免自身心算出错时（大数乘除、浮点、开方、组合数、均值方差、复利等模型易算错的场景）。',
    '已预导入 math / statistics / decimal / fractions / itertools / json / datetime / re / cmath，直接用（如 math.sqrt、statistics.mean、decimal.Decimal），无需 import；用 print() 输出最终答案。',
    '仅限数值/数据处理，禁止任何文件/网络/系统操作。',
  ].join(''),
  category: 'query',
  meta: { summary: 'Python 精确计算', resultCap: 4000 },
  parameters: {
    type: 'object',
    properties: { code: { type: 'string', description: 'Python 计算代码（用 print() 输出结果）' } },
    required: ['code'],
  },
  async execute(params) {
    const cfg = Config.get?.().agent?.calc || {}
    const r = await runPython(String(params?.code || ''), {
      python: cfg.python || 'python3',
      timeout: (cfg.timeout ?? 10) * 1000,
    })
    if (r.missing) return { error: `python3 不可用（${cfg.python || 'python3'} 未安装/不在 PATH）。请在运行环境安装 python3 后重试。` }
    if (r.timedOut) return { error: '计算超时（疑似死循环或计算量过大），请简化/拆分代码后重试。' }
    const out = (r.stdout || '').trim()
    if (!r.ok) {
      // traceback 末尾几行最有用
      const tail = (r.stderr || '执行失败').trim().split('\n').filter(Boolean).slice(-4).join('\n')
      return { error: tail }
    }
    return { ok: true, result: out || '(无输出——请用 print() 输出计算结果)' }
  },
}
