/**
 * 渲染封装 —— 经 Yunzai 核心 lib/puppeteer 把 HTML 渲染为图片，并为深度研究提供
 * PDF 导出与高清长图（独立 puppeteer 浏览器，懒加载单例）。
 *
 * 所有方法失败返回 null / false，调用方据此降级（PDF→高清图→文本）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { buildHtml, mdToHtml } from '../model/render/index.js'

let _shotSeq = 0

/**
 * 经 Yunzai 内置 renderer 截图（jpeg）。
 *
 * Yunzai 渲染器为「模板模式」：screenshot(name, data) 要求 data.tplFile（模板文件路径），
 * 不支持裸 data.html；其 dealTpl 用 art-template 渲染模板。
 * 本插件生成的 HTML 是自包含的纯 HTML（无 art-template 的 {{}} 语法），art-template 对其原样输出（已验证）。
 * 故：把完整 HTML 写入临时文件作为 tplFile 传入，复用 Yunzai 已启动的 Chromium（Docker 等环境依赖此路径）。
 *
 * 用「name + 自增序号」做唯一 tplFile：保证每次都重新读取最新 HTML，避开渲染器的模板缓存
 * （聊天列表 / 人设列表等内容会变化）。失败返回 null，调用方据此降级为文本。
 */
export async function screenshot(name, html) {
  try {
    const mod = await import('../../../lib/puppeteer/puppeteer.js')
    const puppeteer = mod.default || mod
    if (!puppeteer?.screenshot) return null

    const safe = String(name || 'agents').replace(/[\\/]/g, '_')
    const dir = path.join(process.cwd(), 'temp', 'agents-plugin')
    await fs.promises.mkdir(dir, { recursive: true }).catch(() => {})
    // 清理同 name 的旧临时模板，避免磁盘无限堆积
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(`${safe}__`)) fs.unlinkSync(path.join(dir, f))
      }
    } catch { /* noop */ }
    // 唯一文件名 → 渲染器每次缓存未命中 → 始终读取最新 HTML
    _shotSeq = (_shotSeq + 1) % 100000
    const tplFile = path.join(dir, `${safe}__${_shotSeq}.html`)
    await fs.promises.writeFile(tplFile, String(html ?? ''))

    return await puppeteer.screenshot(name, { tplFile, saveId: safe })
  } catch (e) {
    return null
  }
}

/**
 * 把一段文本（markdown）渲染成回复图片（segment.image），失败返回 null。
 * markdown→HTML 用 marked+highlight.js（依赖缺失时自动降级为简易渲染）；截图经 Yunzai 渲染器。
 */
export async function renderReplyImage(content) {
  try {
    const bodyHtml = await mdToHtml(content)
    const html = buildHtml({ bodyHtml })
    return await screenshot('agents-plugin/reply', html)
  } catch (e) {
    return null
  }
}

// ─── 独立 puppeteer 浏览器（懒加载单例，用于 PDF / 高清图）───
let _browser = null
let _launching = null

async function getBrowser() {
  if (_browser) return _browser
  if (_launching) return _launching
  _launching = (async () => {
    try {
      const mod = await import('puppeteer')
      const pptr = mod.default || mod
      _browser = await pptr.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      })
      return _browser
    } catch (e) {
      _browser = null
      return null
    } finally {
      _launching = null
    }
  })()
  return _launching
}

async function withPage(html, fn) {
  const browser = await getBrowser()
  if (!browser) return null
  let page = null
  try {
    page = await browser.newPage()
    await page.setContent(String(html), { waitUntil: 'load', timeout: 30000 })
    return await fn(page)
  } catch (e) {
    return null
  } finally {
    if (page) page.close().catch(() => {})
  }
}

/**
 * 渲染 HTML 为 PDF 文件。
 * @param {string} html
 * @param {object} opts { path, format='A4' }
 * @returns {Promise<string|null>} 成功返回写入路径，失败 null
 */
export async function renderPdf(html, { path: outPath, format = 'A4' } = {}) {
  if (!outPath) return null
  try {
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true })
  } catch { /* noop */ }
  const buff = await withPage(html, (page) =>
    page.pdf({
      format,
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
      preferCSSPageSize: false,
    }),
  )
  if (!buff) return null
  try {
    await fs.promises.writeFile(outPath, buff)
    return outPath
  } catch (e) {
    return null
  }
}

/**
 * 渲染 HTML 为高清长图（fullPage，deviceScaleFactor 提升清晰度）。
 * @param {string} name 缓存名（保留参数，便于复用 Yunzai 截图命名）
 * @param {string} html
 * @param {object} opts { scale=2, imgType='png', width=820 }
 * @returns {Promise<Buffer|null>}
 */
export async function renderHd(name, html, { scale = 2, imgType = 'png', width = 820 } = {}) {
  const buff = await withPage(html, async (page) => {
    await page.setViewport({ width, height: 1200, deviceScaleFactor: scale })
    const opt = { type: imgType, fullPage: true }
    if (imgType === 'jpeg') opt.quality = 92
    return page.screenshot(opt)
  })
  return buff && Buffer.isBuffer(buff) ? buff : null
}
