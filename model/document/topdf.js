/**
 * file_to_pdf 工具 —— 任意文件转 PDF 并发送到聊天。
 *
 * 引擎（按可用性与类型择优）：
 *  1. LibreOffice（soffice --headless --convert-to pdf）：万能且保真，docx/xlsx/pptx/odt
 *     /图片/文本 等全吃。需系统安装（容器内 apt-get install -y libreoffice）。
 *  2. renderPdf（puppeteer，已就绪，优先系统 Chromium）：图片/文本/markdown/html/xlsx
 *     → 渲染 HTML → 打印 PDF。无需系统依赖。
 *  3. docx/pptx 等无 LibreOffice 时：明确报错引导安装（纯 JS 无法保真转换）。
 *
 * 输入：path（本地路径）或 已发送的附件（name/index，从 ctx.media 取并落临时文件）。
 * 不造轮子：复用 renderPdf、excelBufferToText、buildHtml/mdToHtml。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import Config from '../../utils/Config.js'
import Log from '../../utils/Log.js'
import { renderPdf } from '../../apps/render.js'
import { buildHtml, mdToHtml } from '../render/index.js'
import { excelBufferToText } from './excel.js'

const TEMP_DIR = () => Config.path.temp
const sofficeBin = () => Config.get().agent?.document?.soffice || 'soffice'

const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'])
const TEXT_EXTS = new Set(['txt', 'log', 'ini', 'conf', 'env', 'ts', 'js', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'sh', 'yaml', 'yml', 'json'])
let _sofficeMissing = false // 缓存：soffice 不存在则后续跳过，避免每次 ENOENT

function extOf(p) { return path.extname(p).slice(1).toLowerCase() }
function safeName(s) { return String(s || 'output').replace(path.extname(s || ''), '').replace(/[^\w一-龥-]/g, '_').slice(0, 60) }
function tmpPdf(base) { fs.mkdirSync(TEMP_DIR(), { recursive: true }); return path.join(TEMP_DIR(), `${safeName(base)}_${Date.now().toString(36)}.pdf`) }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

/** 解析输入：path 或已发送附件（落临时文件） */
function resolveInput(ctx, p) {
  if (p.path && fs.existsSync(p.path)) return { path: p.path, name: path.basename(p.path) }
  const active = Array.isArray(ctx?.media) ? ctx.media : ctx?.media?.active || []
  if (!active.length) return { error: '未找到文件：请提供 path，或先发送文件后引用' }
  let mf
  if (p.name) mf = active.find((m) => m.name === p.name) || active.find((m) => m.name?.includes(p.name))
  else if (p.index != null) mf = active[(Number(p.index) || 1) - 1]
  else mf = active[0]
  if (!mf) return { error: '未找到匹配的附件', available: active.map((m) => m.name) }
  if (!mf.buffer) return { error: `附件未就绪：${mf.resolveError || '未下载'}` }
  const ext = mf.ext ? (mf.ext.startsWith('.') ? mf.ext : `.${mf.ext}`) : path.extname(mf.name || '')
  const tp = path.join(TEMP_DIR(), `in_${Date.now().toString(36)}${ext || '.bin'}`)
  fs.mkdirSync(TEMP_DIR(), { recursive: true })
  fs.writeFileSync(tp, mf.buffer)
  return { path: tp, name: mf.name }
}

/** 调 soffice 转 pdf；返回 {path} 或 {error, missing} */
function runSoffice(input, outDir) {
  return new Promise((resolve) => {
    execFile(sofficeBin(), ['--headless', '--convert-to', 'pdf', '--outdir', outDir, input], { timeout: 120000 }, (e) => {
      if (e) {
        const missing = /ENOENT|not found/i.test(e.message)
        if (missing) _sofficeMissing = true
        return resolve({ error: e.message, missing })
      }
      const out = path.join(outDir, path.basename(input, path.extname(input)) + '.pdf')
      resolve(fs.existsSync(out) ? { path: out } : { error: 'soffice 未产出 PDF' })
    })
  })
}

/** csv 文本 → markdown 表格（首行作表头） */
function csvToMd(text) {
  const rows = String(text || '').split(/\r?\n/).filter((l) => l.trim())
  if (!rows.length) return ''
  const split = (r) => r.split(',').map((c) => c.trim())
  const head = split(rows[0])
  const body = rows.slice(1).map(split)
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n')
}

/** 按 ext 把文件内容转成 inner HTML（供 buildHtml 包裹后 renderPdf） */
async function toInnerHtml(inputPath, ext) {
  if (IMG_EXTS.has(ext)) {
    const buf = fs.readFileSync(inputPath)
    const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
    return `<img style="max-width:100%;height:auto;display:block;margin:0 auto" src="data:${mime};base64,${buf.toString('base64')}">`
  }
  if (ext === 'md') return await mdToHtml(fs.readFileSync(inputPath, 'utf8'))
  if (ext === 'html' || ext === 'htm') return fs.readFileSync(inputPath, 'utf8')
  if (ext === 'xlsx' || ext === 'xls') {
    const out = await excelBufferToText(fs.readFileSync(inputPath), { maxRows: 200 })
    if (out.error) throw new Error(out.error)
    return await mdToHtml(out.text || '')
  }
  if (ext === 'csv') return await mdToHtml(csvToMd(fs.readFileSync(inputPath, 'utf8')))
  // 纯文本类
  const txt = fs.readFileSync(inputPath, 'utf8')
  return `<pre style="white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.6">${esc(txt)}</pre>`
}

/** 主转换：inputPath → 产出 PDF 路径 */
async function convert(inputPath, baseName) {
  const ext = extOf(inputPath)
  // PDF 直接透传
  if (ext === 'pdf') { const out = tmpPdf(baseName); fs.copyFileSync(inputPath, out); return { path: out, engine: 'passthrough' } }

  // 1) LibreOffice（若可用）：万能保真
  if (!_sofficeMissing) {
    const r = await runSoffice(inputPath, TEMP_DIR())
    if (r.path) { const out = tmpPdf(baseName); fs.copyFileSync(r.path, out); return { path: out, engine: 'libreoffice' } }
    if (!r.missing) Log.warn('[topdf] soffice 转换失败，回退纯 JS', r.error)
  }

  // 2) 纯 JS（renderPdf / puppeteer）：图片/文本/markdown/html/xlsx/csv
  if (IMG_EXTS.has(ext) || ['md', 'html', 'htm', 'xlsx', 'xls', 'csv', ...TEXT_EXTS].includes(ext)) {
    const inner = await toInnerHtml(inputPath, ext)
    const html = buildHtml({ title: safeName(baseName), bodyHtml: inner })
    const out = tmpPdf(baseName)
    const pdfPath = await renderPdf(html, { path: out })
    if (pdfPath) return { path: pdfPath, engine: 'puppeteer' }
    return { error: _sofficeMissing ? '渲染 PDF 失败（puppeteer/Chromium 不可用）；docx/pptx 等需装 LibreOffice' : '渲染 PDF 失败' }
  }

  // 3) 不支持（docx/pptx/odt 等需 LibreOffice）
  return {
    error: _sofficeMissing
      ? `此类型(${ext || '未知'})转 PDF 需安装 LibreOffice：在容器内 apt-get install -y libreoffice，并在配置 agent.document.soffice 指定 soffice 路径`
      : `转换失败：${ext || '未知'} 不支持`,
  }
}

export const fileToPdfTool = {
  name: 'file_to_pdf',
  description: '把任意文件转成 PDF 并发送到聊天。支持图片(png/jpg/webp/gif)、文本/markdown/html、Excel(xlsx/csv)；docx/pptx 等需服务器装 LibreOffice(更保真)。输入可用 path 或已发送的附件(name/index)。',
  category: 'query',
  meta: { summary: '文件转 PDF', interactive: true },
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '本地文件路径（与 name/index 二选一）' },
      name: { type: 'string', description: '已发送的附件名（模糊匹配，自动落盘后转换）' },
      index: { type: 'integer', description: '附件序号(从1开始，与 name 二选一)' },
    },
  },
  async execute(p, ctx) {
    const input = resolveInput(ctx, p)
    if (input.error) return { error: input.error }
    const base = p.name || path.basename(input.path)
    let res
    try { res = await convert(input.path, base) }
    catch (e) { return { error: `转换失败：${e?.message || e}` } }
    if (res.error) return res
    // 发送 PDF（创建即发送，无需再调 send_file）
    const seg = (typeof segment !== 'undefined' && segment) || null
    let sent = false
    if (seg && ctx?.e?.reply) {
      try { await ctx.e.reply(seg.file(res.path, `${safeName(base)}.pdf`)); sent = true } catch (e) { Log.warn('[topdf] 发送 PDF 失败', e?.message || e) }
    }
    return {
      ok: true, engine: res.engine, path: res.path, sent,
      note: sent ? 'PDF 已发送到聊天' : 'PDF 已生成但发送失败（可用 send_file 重发）',
      ...(p.path && input.path !== p.path ? { tempInput: input.path } : {}),
    }
  },
}
