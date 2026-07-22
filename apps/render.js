/**
 * 渲染封装 —— 经 Yunzai 核心 lib/puppeteer 把 HTML 渲染为图片，并为深度研究提供
 * PDF 导出与高清长图（独立 puppeteer 浏览器，懒加载单例）。
 *
 * 所有方法失败返回 null / false，调用方据此降级（PDF→高清图→文本）。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 经 Yunzai 内置 renderer 截图（jpeg）。puppeteer 不可用时返回 null。 */
export async function screenshot(name, html) {
  try {
    const mod = await import('../../../lib/puppeteer/puppeteer.js')
    const puppeteer = mod.default || mod
    if (puppeteer?.screenshot) return await puppeteer.screenshot(name, { html })
    return null
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
