/**
 * Pixiv 模块公共出口。
 *
 * 用法（apps/agent.js buildRuntime）：
 *   import { pixivTools } from '../model/pixiv/index.js'
 *   if (cfg.pixiv?.enable !== false && cfg.pixiv?.refreshToken) tools.register(...pixivTools)
 */

export { pixivTools } from './tools.js'
export { getPixiv, proxyImage } from './client.js'
