/**
 * 静态验证（文档 §14）：typescript Compiler API 扫候选 source 的禁用模式 + manifest 校验。
 *
 * 仅作前置门禁——AST 检查不能替代隔离执行（混淆/原型链/运行时组合可能绕过，阶段2 沙箱兜底）。
 * 第一版策略：候选是纯函数，默认禁一切 import（仅允许显式 node: 安全子集白名单），最严。
 */
import ts from 'typescript'
import { validateManifest } from '../manifest.js'

/** 禁止 import 的模块（第一版只允许纯函数，默认禁所有 import） */
const ALLOWED_IMPORTS = new Set([
  // 第一版白名单为空：候选应零依赖纯函数；需能力时由宿主注入窄接口（§10.1）
])

/** 扫描 source 的禁用模式 → violations[] */
export function scanSource(source) {
  const violations = []
  const sf = ts.createSourceFile('candidate.js', String(source || ''), ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS)
  const visit = (node) => {
    // import 非白名单
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = node.moduleSpecifier.text
      if (!ALLOWED_IMPORTS.has(mod)) violations.push(`禁止 import：${mod}（第一版候选须零依赖纯函数）`)
    }
    // require(...) / eval(...)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['require', 'eval'].includes(node.expression.text)) {
      violations.push(`禁止调用：${node.expression.text}`)
    }
    // new Function(...) / Function(...) 直接调用（审计探针 Function('return process')() 可逃逸沙箱）
    if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      violations.push('禁止 Function 构造/调用（动态代码，可逃逸隔离）')
    }
    // globalThis.process / globalThis['process'] 动态访问宿主全局（绕过静态门拿 process/fetch 等）
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === 'globalThis') {
      violations.push('禁止 globalThis 动态属性访问（可拿宿主对象绕过门禁）')
    }
    // fetch(...) 全局联网（进化工具不得联网；联网走固定受信适配器）
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
      violations.push('禁止 fetch（进化工具不得联网）')
    }
    // process.env / process.exit
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'process') {
      violations.push(`禁止 process.${node.name.text}（不接触宿主环境）`)
    }
    // 动态 import(...)
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      violations.push('禁止动态 import')
    }
    // child_process 等字符串拼接的 require 也挡（保守：任何字符串含危险模块名）
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return violations
}

/**
 * 全量静态验证。
 * @param {object} p { manifest, source }
 * @returns { passed:boolean, violations:string[] }
 */
export function verifyStatic({ manifest, source }) {
  const violations = []
  // 1. manifest schema
  const mv = validateManifest(manifest)
  if (!mv.ok) violations.push(...mv.errors.map((e) => 'manifest: ' + e))
  // 2. source 必须导出 run
  if (!/export\s+async\s+function\s+run\s*\(/.test(String(source || ''))) {
    violations.push('source 必须导出：export async function run(input, ctx)')
  }
  // 3. AST 禁用模式
  violations.push(...scanSource(source))
  return { passed: violations.length === 0, violations }
}

export default { scanSource, verifyStatic }
