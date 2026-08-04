/**
 * 参数注入：把模型给的 friendly 参数（prompt/seed/steps/width/...）写到工作流 JSON
 * 的对应节点字段上（按 PARAM_MAPS 定位）。
 *
 * 约定：
 *  - 未传的字段保留模板默认值（不覆盖）；
 *  - preset 决定哪些参数生效（如 txt2img 模板忽略 denoise/input_image）；
 *  - seed 留空/负数 → 随机（记 seedUsed 回传，方便复现）；
 *  - input_image/mask_image 不直接写字面值——值来自 execute 上传后 server 返回的
 *    filename（见 opts.uploaded），写进 LoadImage/LoadImageMask 节点。
 */

import { PARAM_MAPS } from './param-maps.js'

/** ComfyUI seed 是大整数；MAX_SAFE_INTEGER 内足够且兼容 server */
function randomSeed() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
}

function unwrap(wf) {
  if (wf && typeof wf === 'object' && wf.prompt && typeof wf.prompt === 'object' && !wf.class_type) {
    return wf.prompt
  }
  return wf
}

/** 数值类字段转 number；其余原样 */
function coerce(field, v) {
  const NUM_INT = ['seed', 'steps', 'width', 'height', 'length', 'frame_rate', 'batch_size', 'noise_seed']
  const NUM_FLT = ['cfg', 'denoise']
  if (NUM_INT.includes(field) || NUM_FLT.includes(field)) {
    const n = Number(v)
    return Number.isFinite(n) ? n : v
  }
  return v
}

/**
 * @param {object} wf loadPreset 的产物（会被原地修改）
 * @param {string} preset
 * @param {object} overrides 模型给的参数（含 input_image 等附件引用）
 * @param {object} opts { uploaded?: { image?:{name}, mask?:{name} } }
 * @returns {{ok:true, seedUsed:number|null} | {ok:false, error:string}}
 */
export function applyParams(wf, preset, overrides = {}, opts = {}) {
  const map = PARAM_MAPS[preset]
  if (!map) return { ok: false, error: `未知 preset：${preset}` }
  const graph = unwrap(wf)
  let seedUsed = null

  const setField = (key, value) => {
    const m = map[key]
    if (!m) return true // 该模板不支持此参数，静默跳过（preset 决定生效集）
    const node = graph[m.node]
    if (!node || typeof node !== 'object' || !node.inputs) {
      return { error: `模板 ${preset} 节点 ${m.node} 不存在（参数 ${key}）` }
    }
    node.inputs[m.field] = coerce(m.field, value)
    return true
  }

  for (const [key, val] of Object.entries(overrides)) {
    // 控制类参数（非工作流字段）跳过
    if (['preset', 'timeout', 'send_images', 'input_image', 'mask_image'].includes(key)) continue
    if (val == null || val === '') continue

    if (key === 'seed') {
      // -1 / 负数 / 非法 → 随机
      const n = Number(val)
      if (!Number.isFinite(n) || n < 0) {
        seedUsed = randomSeed()
      } else {
        seedUsed = n
      }
      const r = setField('seed', seedUsed)
      if (r && r.error) return { ok: false, error: r.error }
      continue
    }
    const r = setField(key, val)
    if (r && r.error) return { ok: false, error: r.error }
  }

  // img2img/inpaint：输入图 + 蒙版（值来自上传结果）
  if (map.input_image) {
    const name = opts.uploaded?.image?.name
    if (!name) return { ok: false, error: '该模板需要输入图（input_image），但未上传成功' }
    const r = setField('input_image', name)
    if (r && r.error) return { ok: false, error: r.error }
  }
  if (map.mask_image) {
    const name = opts.uploaded?.mask?.name
    if (!name) return { ok: false, error: 'inpaint 需要蒙版图（mask_image），但未上传成功' }
    const r = setField('mask_image', name)
    if (r && r.error) return { ok: false, error: r.error }
  }

  // seed 未传但模板有 seed → 随机一个并写入（保证 seedUsed 可回传）
  if (seedUsed == null && map.seed) {
    seedUsed = randomSeed()
    const r = setField('seed', seedUsed)
    if (r && r.error) return { ok: false, error: r.error }
  }

  return { ok: true, seedUsed }
}
