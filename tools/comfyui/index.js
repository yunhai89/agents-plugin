/**
 * ComfyUI 工具包 —— 通过 ComfyUI 生成图片/视频。
 *
 * 移植自 Hermes comfyui 技能（/root/.hermes/skills/creative/comfyui），但执行方式
 * 改为 Node 原生：execute 直接调 ComfyUI REST API（不走 Hermes Python 脚本、不走
 * Docker terminal 沙箱），图片经 ctx.e.reply(segment.image) 直发聊天。
 *
 * 工具：
 *  - comfyui__generate      主工具：选工作流模板(preset)+填参数 → 生成 → 发图
 *  - comfyui__status        探测 server 连通性/版本/显存/队列（运维）
 *  - comfyui__list_models   列服务器上的模型（运维）
 *
 * 未启用（config agent.comfyui.enable:false）时 factory 返回 []，零影响。
 * 参考：发图先例 model/pixiv/tools.js:90-95；工具契约 model/toolkit/define.js。
 */

import crypto from 'node:crypto'
import { defineToolPack, defineTool, param, ok, fail } from '../../model/toolkit/index.js'
import Config from '../../utils/Config.js'
import Log from '../../utils/Log.js'
import { resolveMedia } from '../../model/media/resolve.js'
import { newClient } from './api.js'
import { PRESETS, availablePresets, loadPreset } from './workflows.js'
import { applyParams } from './inject.js'
import { presetNeedsInputImage, presetNeedsMask } from './param-maps.js'
import { sendImageToChat, sendVideoAsFile, saveToTemp } from './send.js'

const cfg = () => Config.get().agent?.comfyui || {}

// 载入时自检：剔除与 PARAM_MAPS 不同步的模板（早失败）
const logger = (lvl, msg) => { try { Log[lvl]?.('comfyui', msg) } catch { /* noop */ } }
export const AVAILABLE_PRESETS = availablePresets(logger)

const newClientId = () => (globalThis.crypto?.randomUUID?.() || crypto.randomUUID())

/** 取输入图 buffer：附件名 / URL / __last__(最近一张图片附件) */
async function resolveInputImage(ref, ctx, fetcher) {
  const media = Array.isArray(ctx?.media) ? ctx.media : []
  const imgs = media.filter((m) => m && (m.kind === 'image' || (m.mime || '').startsWith('image/')))
  let pick = null
  if (!ref || ref === '__last__') {
    pick = imgs[imgs.length - 1] || null
  } else if (/^https?:\/\//i.test(String(ref))) {
    const f = fetcher || globalThis.fetch
    if (f) {
      try {
        const r = await f(ref)
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer())
          pick = { buffer: buf, name: String(ref).split('/').pop()?.split('?')[0] || 'input.png' }
        }
      } catch { /* noop */ }
    }
  } else {
    pick = imgs.find((m) => m.name === ref || m.filename === ref) || null
  }
  if (!pick) return null
  if (pick.buffer) return { buffer: pick.buffer, name: pick.name || pick.filename || 'input.png' }
  // resolveMedia 补 buffer（群文件/离线文件等无 url 场景）
  try {
    const r = await resolveMedia(pick, { bot: ctx?.bot, fetcher, e: ctx?.e })
    if (r?.buffer) return { buffer: r.buffer, name: r.name || pick.name || 'input.png' }
  } catch { /* noop */ }
  return null
}

// ─── comfyui__generate ───
const generateTool = defineTool({
  name: 'generate',
  description:
    '通过 ComfyUI 生成图片或视频。按 preset 选工作流模板，用 prompt/seed/steps/width/height/negative_prompt/model 等覆盖参数，生成后自动把图片发到当前会话。img2img/inpaint/upscale 需提供 input_image（可填会话内附件名、图片 URL，或留空用最近一张图）；inpaint 还需 mask_image。每次生成消耗 GPU，会触发主人审批。',
  category: 'query',
  meta: { summary: 'ComfyUI 生成图片/视频', interactive: true, alwaysConfirm: true, resultCap: 4000 },
  parameters: param.object({
    preset: param.enum('工作流模板：' + AVAILABLE_PRESETS.map((p) => `${p}(${PRESETS[p]?.label || p})`).join(' / '), AVAILABLE_PRESETS),
    prompt: param.str('正向提示词（英文效果最佳；描述画面、风格、质量词，如 masterpiece, highly detailed, cinematic lighting）'),
    negative_prompt: param.str('反向提示词（不想要的元素，如 ugly, blurry, low quality）；Flux 模板无此项'),
    seed: param.int('随机种子（整数；留空或负数=随机；想复现填固定值）'),
    steps: param.int('采样步数（15-25 常用；越多越慢越细，超 30 收益低）'),
    cfg: param.num('CFG scale 引导强度（5-9 常用）'),
    width: param.int('图宽（SD1.5 用 512/768；SDXL/Flux 用 1024）', { min: 64 }),
    height: param.int('图高（同上）', { min: 64 }),
    model: param.str('覆盖默认 checkpoint/UNet 文件名（须服务器上已存在；不确定先调 comfyui__list_models）'),
    denoise: param.num('img2img 去噪强度 0-1（越高越偏离原图；inpaint 常用 0.6-0.8）'),
    batch_size: param.int('一次生成张数（默认 1；视频模板此项为帧数请用 length）'),
    input_image: param.str('img2img/inpaint/upscale 必填：输入图。附件名 / 图片 URL / 留空用最近一张'),
    mask_image: param.str('inpaint 必填：蒙版图（白色=要重绘区域）。取法同 input_image'),
    length: param.int('视频帧数（仅视频模板）'),
    frame_rate: param.int('视频帧率（仅视频模板）'),
    timeout: param.int('单次最长等待秒数（默认走配置；视频自动放宽到 900）'),
    send_images: param.bool('是否发送图片到聊天（默认 true）'),
  }, ['preset', 'prompt']),
  async execute(p, ctx) {
    const c = cfg()
    if (!c.enable) return fail('ComfyUI 未启用（config agent.comfyui.enable）')
    if (!AVAILABLE_PRESETS.includes(p.preset)) return fail(`不可用的 preset：${p.preset}（该模板自检失败或不存在）`)

    const fetcher = ctx?.fetcher || globalThis.fetch
    const api = newClient({ host: c.host, apiKey: c.apiKey, cloud: c.cloud, fetcher })

    // 0. 连通性快探（失败给清晰错误，而非卡到超时）
    const probe = await api.systemStats().catch(() => null)
    if (!probe) return fail(`ComfyUI 不可达：${c.host}（检查 host/端口/进程；Cloud 模式确认 apiKey）`, { recoverable: true })

    // 1. 载入模板 + 注入参数
    const wf = loadPreset(p.preset)
    const uploaded = {}
    if (presetNeedsInputImage(p.preset)) {
      const img = await resolveInputImage(p.input_image, ctx, fetcher)
      if (!img) return fail(`该模板需要输入图（input_image），但未提供或取不到。让用户先发一张图，或给图片 URL`, { recoverable: true })
      try {
        uploaded.image = await api.uploadImage(img.buffer, img.name, 'input')
      } catch (e) { return fail(`上传输入图失败：${e?.message || e}`) }
      if (presetNeedsMask(p.preset)) {
        const m = await resolveInputImage(p.mask_image, ctx, fetcher)
        if (!m) return fail('inpaint 需要蒙版图（mask_image），但未提供或取不到', { recoverable: true })
        try {
          uploaded.mask = await api.uploadMask(m.buffer, m.name, { filename: uploaded.image.name, subfolder: uploaded.image.subfolder || '', type: 'input' })
        } catch (e) { return fail(`上传蒙版失败：${e?.message || e}`) }
      }
    }
    const injected = applyParams(wf, p.preset, p, { uploaded })
    if (!injected.ok) return fail(injected.error)

    // 2. 提交
    const clientId = newClientId()
    let promptId
    try {
      const sub = await api.submit(wf, clientId)
      promptId = sub?.prompt_id
      if (!promptId) return fail(`提交未返回 prompt_id：${JSON.stringify(sub).slice(0, 300)}`)
    } catch (e) {
      // node_errors（缺节点/模型名）透给模型，让其换 preset 或提示装模型
      return fail(e?.message || String(e), { node_errors: e?.node_errors, recoverable: true })
    }

    // 3. 轮询
    const isVideo = !!PRESETS[p.preset]?.isVideo
    const timeout = Math.min(Number(p.timeout) || (isVideo ? 900 : c.timeout || 300), 1800)
    const result = await api.pollStatus(promptId, { timeout, interval: c.pollInterval || 1.5, maxInterval: c.pollMaxInterval || 8 })
    if (result.status === 'error') return fail(`生成失败：${result.message || 'execution_error'}${result.nodeId ? `（节点 ${result.nodeId}）` : ''}`, { prompt_id: promptId, recoverable: true })
    if (result.status === 'cancelled') return fail('任务被取消', { prompt_id: promptId })
    if (result.status === 'timeout') {
      api.interrupt().catch(() => {})
      return fail(`超时（${timeout}s）。prompt_id=${promptId}；可调大 timeout 或换更轻模板`, { prompt_id: promptId })
    }

    // 4. 收集产物 + 下载 + 发图
    const outs = (result.outputs || []).slice(0, Math.max(1, Number(c.maxImages) || 4))
    const sent = []
    for (const o of outs) {
      try {
        const buf = await api.downloadOutput(o)
        if (o.kind === 'image' && p.send_images !== false) {
          const r = await sendImageToChat(ctx, { buffer: buf, filename: o.filename })
          sent.push({ filename: o.filename, kind: 'image', sent: r.ok, ...(r.ok ? {} : { reason: r.reason }) })
        } else if (o.kind === 'video' || o.kind === 'audio') {
          const saved = saveToTemp(buf, o.filename, c)
          const r = await sendVideoAsFile(ctx, saved, o.filename)
          sent.push({ filename: o.filename, kind: o.kind, sent: r.ok, path: saved, ...(r.ok ? {} : { reason: r.error }) })
        } else {
          const saved = saveToTemp(buf, o.filename, c)
          sent.push({ filename: o.filename, kind: o.kind || 'file', path: saved })
        }
      } catch (e) {
        sent.push({ filename: o.filename, kind: o.kind, sent: false, reason: e?.message || String(e) })
      }
    }

    return ok({
      preset: p.preset,
      prompt_id: promptId,
      seed_used: injected.seedUsed,
      outputs: sent,
      note: sent.some((s) => s.sent) ? `已发送 ${sent.filter((s) => s.sent).length} 个产物` : (sent.length ? '生成完成但发送失败' : '完成但无可发产物'),
    })
  },
})

// ─── comfyui__status ───
const statusTool = defineTool({
  name: 'status',
  description: '探测 ComfyUI 服务器连通性、版本、显存、当前队列。配置或排错时用。',
  category: 'system',
  parameters: param.object({}, []),
  async execute(_p, ctx) {
    const c = cfg()
    if (!c.enable) return fail('ComfyUI 未启用')
    const api = newClient({ host: c.host, apiKey: c.apiKey, cloud: c.cloud, fetcher: ctx?.fetcher || globalThis.fetch })
    try {
      const stats = await api.systemStats()
      return ok({
        host: c.host,
        cloud: api.isCloud,
        version: stats?.system?.comfyui_version,
        python: stats?.system?.python_version,
        devices: (stats?.devices || []).map((d) => ({ name: d.name, type: d.type, vram_total: d.vram_total, vram_free: d.vram_free })),
        queue_remaining: stats?.queue_remaining,
      })
    } catch (e) {
      return fail(`ComfyUI 不可达：${c.host} — ${e?.message || e}`)
    }
  },
})

// ─── comfyui__list_models ───
const listModelsTool = defineTool({
  name: 'list_models',
  description: '列出 ComfyUI 服务器上指定文件夹的可用模型（checkpoints/loras/vae/unet/clip/controlnet/upscale_models）。选 model 参数时用。',
  category: 'system',
  parameters: param.object({
    folder: param.enum('模型文件夹', ['checkpoints', 'loras', 'vae', 'unet', 'clip', 'controlnet', 'upscale_models']),
  }, ['folder']),
  async execute(p, ctx) {
    const c = cfg()
    if (!c.enable) return fail('ComfyUI 未启用')
    const api = newClient({ host: c.host, apiKey: c.apiKey, cloud: c.cloud, fetcher: ctx?.fetcher || globalThis.fetch })
    try {
      const list = await api.listModels(p.folder)
      const names = Array.isArray(list) ? list.map((m) => (typeof m === 'string' ? m : m.name)).filter(Boolean) : []
      return ok({ folder: p.folder, count: names.length, models: names.slice(0, 100) })
    } catch (e) {
      return fail(`列模型失败：${e?.message || e}`)
    }
  },
})

export default defineToolPack({
  name: 'comfyui',
  description: 'ComfyUI 图像/视频生成（文生图/图生图/局部重绘/放大/视频）',
  author: 'trss-agent-plugin',
  version: '1.0.0',
  // enable:false 时不注册任何工具（零影响，仿 pixiv/sticker）
  factory: () => (cfg().enable ? [generateTool, statusTool, listModelsTool] : []),
})
