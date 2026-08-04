/**
 * 工作流模板加载 + 载入自检。
 *
 * 模板放 ./workflows/<preset>.json（从 Hermes comfyui 原样复制，ComfyUI 原生 API 格式：
 * 顶层节点ID → { class_type, inputs }）。协议无关，可被 Node 直接 POST 到 /prompt。
 *
 * 载入自检（verifyMaps）：对每个 PARAM_MAPS[preset] 的 {node, field} 断言在 JSON 里存在；
 * 缺失（模板与映射表不同步）则标 disabled，从可用 preset 列表剔除——早失败，避免运行时
 * 提交后才被 server 以 node_errors 打回。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PARAM_MAPS } from './param-maps.js'

const WF_DIR = fileURLToPath(new URL('./workflows', import.meta.url))

/** preset 元信息：label（友好名）/ 描述 / isVideo（视频模板轮询超时放宽） */
export const PRESETS = {
  sd15_txt2img: { label: 'SD1.5 文生图', desc: '最快，512×512，显存友好', isVideo: false },
  sdxl_txt2img: { label: 'SDXL 文生图', desc: '高质量，1024×1024，通用首选', isVideo: false },
  flux_dev_txt2img: { label: 'Flux Dev 文生图', desc: '最强写实，仅正向提示词，慢', isVideo: false },
  sdxl_img2img: { label: 'SDXL 图生图', desc: '改风格/重绘，需输入图', isVideo: false },
  sdxl_inpaint: { label: 'SDXL 局部重绘', desc: '改局部，需输入图+蒙版', isVideo: false },
  upscale_4x: { label: '4× 放大', desc: 'ESRGAN 超分，需输入图', isVideo: false },
  animatediff_video: { label: 'AnimateDiff 短视频', desc: 'SD1.5 基底 16 帧', isVideo: true },
  wan_video_t2v: { label: 'Wan 文生视频', desc: 'Wan2.1 t2v，高质量视频', isVideo: true },
}

/** 兼容 {prompt:{...}} 包装与裸 {...} 两种形态（Hermes unwrap_workflow） */
function unwrap(raw) {
  if (raw && typeof raw === 'object' && raw.prompt && typeof raw.prompt === 'object' && !raw.class_type) {
    return raw.prompt
  }
  return raw
}

// 原始模板缓存（首次 readFileSync 后驻留）
const _raw = Object.create(null)
function loadRaw(name) {
  if (!_raw[name]) {
    const fp = path.join(WF_DIR, `${name}.json`)
    _raw[name] = JSON.parse(fs.readFileSync(fp, 'utf8'))
  }
  return _raw[name]
}

/** 深拷贝一份工作流（避免注入参数污染缓存） */
export function loadPreset(name) {
  return JSON.parse(JSON.stringify(loadRaw(name)))
}

/**
 * 载入自检：校验每个 PARAM_MAPS[preset] 的 {node, field} 都在模板里存在。
 * @param {function} logger (level, ...args) 日志钩子
 * @returns {Set<string>} 失败的 preset 名（应从可用列表剔除）
 */
export function verifyMaps(logger) {
  const log = logger || (() => {})
  const disabled = new Set()
  for (const preset of Object.keys(PARAM_MAPS)) {
    try {
      const graph = unwrap(loadRaw(preset))
      for (const [key, { node, field }] of Object.entries(PARAM_MAPS[preset])) {
        const n = graph[node]
        if (!n || typeof n !== 'object' || !n.inputs || !(field in n.inputs)) {
          log('warn', `[comfyui] 模板 ${preset} 参数「${key}」映射失效：节点 ${node} 的字段 ${field} 不存在 — 该模板已禁用`)
          disabled.add(preset)
          break
        }
      }
    } catch (e) {
      log('warn', `[comfyui] 模板 ${preset} 加载失败：${e?.message || e} — 已禁用`)
      disabled.add(preset)
    }
  }
  return disabled
}

/** 可用 preset 名列表（排除自检失败的） */
export function availablePresets(logger) {
  const disabled = verifyMaps(logger)
  return Object.keys(PRESETS).filter((p) => !disabled.has(p))
}
