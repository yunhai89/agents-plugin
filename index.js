/**
 * agents-plugin 入口
 *
 * 自动扫描并加载 apps/ 目录下的所有 .js 应用模块。
 * Yunzai loader 在发现本 index.js 后将只加载它，不会再递归扫描 apps/，
 * 因此应用统一在此处注册，避免重复加载。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Config from './utils/Config.js'
import Log from './utils/Log.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appsDir = path.join(__dirname, 'apps')

if (!fs.existsSync(appsDir)) fs.mkdirSync(appsDir, { recursive: true })

const files = fs
  .readdirSync(appsDir)
  .filter(name => name.endsWith('.js') && name !== 'index.js')

let apps = {}

if (files.length) {
  const results = await Promise.allSettled(
    files.map(file => import(`./apps/${file}`)),
  )

  for (let i = 0; i < files.length; i++) {
    const res = results[i]
    if (res.status !== 'fulfilled') {
      Log.error('应用载入失败', files[i], res.reason)
      continue
    }
    apps = { ...apps, ...res.value }
  }
}

Log.info(`加载完成 v${Config.version}，已载入 ${Object.keys(apps).length} 个应用`)

export { apps }
