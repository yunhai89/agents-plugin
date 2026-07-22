/**
 * 工具包自动加载器 —— TRSS-Yunzai apps 风格。
 *
 * 扫描目录下所有 .js 文件，按导出形态归一为工具包，再拍平为工具数组。
 * 每个文件可导出（任一）：
 *   - export default defineToolPack({...})      → 工具包（推荐）
 *   - export default [tool1, tool2]             → 工具数组（匿名包）
 *   - export default tool                       → 单个工具
 *   - export default function(ctx){ return [...] } → 工厂（按 ctx 动态生成）
 *   - export const pack / tools                 → 命名导出同上
 *
 * 加载失败的单个文件不中断整体加载（记日志后跳过），与 Yunzai 插件加载一致。
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineToolPack } from './define.js'

/** 判断导出物是否已是 pack（defineToolPack 产物） */
function isPack(x) {
  return x && typeof x === 'object' && typeof x.resolve === 'function'
}

/** 把任意导出形态归一为 pack */
function asPack(file, mod, ctx) {
  const exp = mod?.default ?? mod?.pack ?? mod?.tools ?? mod
  // 工厂函数
  if (typeof exp === 'function') {
    return defineToolPack({ name: file, factory: exp })
  }
  // 已是 pack
  if (isPack(exp)) return exp
  // 数组 / 单工具
  const tools = Array.isArray(exp) ? exp : exp && typeof exp === 'object' ? [exp] : []
  return defineToolPack({ name: file, tools })
}

/**
 * 加载目录下所有工具包。
 * @param {string} dir 目录绝对路径
 * @param {object} opts { ctx, logger, ext }
 * @returns {Promise<{ packs, tools, errors }>}
 */
export async function loadToolPacks(dir, { ctx = {}, logger, ext = ['.js', '.mjs'] } = {}) {
  const log = logger || (() => {})
  const packs = []
  const tools = []
  const errors = []
  let files = []
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && ext.includes(path.extname(f.name)))
      .map((f) => f.name)
      .sort()
  } catch (e) {
    // 目录不存在视为无自定义工具，不报错
    return { packs, tools, errors }
  }

  for (const name of files) {
    const full = path.resolve(dir, name)
    try {
      const mod = await import(pathToFileURL(full).href)
      const pack = asPack(path.basename(name, path.extname(name)), mod, ctx)
      const resolved = pack.resolve(ctx)
      for (const t of resolved) {
        try {
          // 经 defineTool 校验
          const { defineTool } = await import('./define.js')
          tools.push(defineTool(t))
        } catch (e) {
          errors.push({ file: name, error: e?.message || String(e) })
          log('warn', `[toolkit] 工具校验失败 ${name}:`, e?.message || e)
        }
      }
      packs.push({ name: pack.name, file: name, count: resolved.length })
      log('info', `[toolkit] 加载工具包 ${pack.name}（${resolved.length} 个工具）`)
    } catch (e) {
      errors.push({ file: name, error: e?.message || String(e) })
      log('error', `[toolkit] 加载失败 ${name}:`, e?.message || e)
    }
  }
  return { packs, tools, errors }
}

export { asPack }
