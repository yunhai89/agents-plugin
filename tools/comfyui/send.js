/**
 * 产物回传辅助 —— 把 ComfyUI 生成的图片/视频发到当前会话。
 *
 * 图片：ctx.e.reply(segment.image('base64://'+b64))（仿 pixiv_illust，生产级先例）。
 *   工具返回值只给元数据——图片字节绝不放进返回值（会被 truncateJson 裁且占满 context）。
 * 视频：QQ segment 不支持视频内联 → 发群文件/私聊文件（sendApi 走 OneBot 原生动作）。
 */

import path from 'node:path'
import fs from 'node:fs'
import Config from '../../utils/Config.js'
import { sendApi } from '../../model/toolkit/index.js'

/**
 * 发图片到当前会话（base64 优先，temp 文件降级）。
 * @returns {{ok:true, tempPath?:string} | {ok:false, reason:string}}
 */
export async function sendImageToChat(ctx, { buffer, filename }) {
  const reply = ctx?.e?.reply
  const seg = (typeof segment !== 'undefined' && segment) || null
  if (!reply || !seg) return { ok: false, reason: 'no_reply_or_segment' }

  // 首选 base64（无需落盘、无清理）
  try {
    const b64 = Buffer.from(buffer).toString('base64')
    await reply(seg.image(`base64://${b64}`))
    return { ok: true }
  } catch (e) {
    // 降级：落 temp 用绝对路径发（个别适配器对大 base64 不友好）
    try {
      const dir = Config.path.temp
      fs.mkdirSync(dir, { recursive: true })
      const p = path.join(dir, `comfy_${Date.now().toString(36)}_${filename || 'out.png'}`)
      fs.writeFileSync(p, buffer)
      await reply(seg.image(p))
      return { ok: true, tempPath: p }
    } catch (e2) {
      return { ok: false, reason: e2?.message || String(e2) }
    }
  }
}

/**
 * 发视频为文件（QQ 不支持视频内联段）。
 * 群聊 → upload_group_file；私聊 → upload_private_file。
 */
export async function sendVideoAsFile(ctx, absPath, name) {
  const isGroup = ctx?.isGroup
  const base = name || path.basename(absPath)
  const action = isGroup ? 'upload_group_file' : 'upload_private_file'
  const params = isGroup
    ? { group_id: ctx.groupId, file: absPath, name: base }
    : { user_id: ctx.userId, file: absPath, name: base }
  return sendApi(ctx, action, params)
}

/** 落盘产物到 outputDir（留空=Config.path.temp），返回绝对路径 */
export function saveToTemp(buffer, filename, cfg = {}) {
  const dir = cfg.outputDir || Config.path.temp
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, `comfy_${Date.now().toString(36)}_${filename}`)
  fs.writeFileSync(p, buffer)
  return p
}
