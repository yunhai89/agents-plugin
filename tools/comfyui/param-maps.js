/**
 * 每个工作流模板的「friendly 参数名 → { node, field }」映射表。
 *
 * node  是 workflows/<preset>.json 里的节点 ID（字符串）；
 * field 是该节点 inputs 里的字段名。
 *
 * 节点 ID 直接取自 Hermes comfyui 模板（已逐模板核实，见 workflows/*.json）。
 * workflows.js 加载时会自检：每个 {node, field} 必须在对应 JSON 里存在，
 * 缺失则把该 preset 标 disabled（早失败，避免运行时才暴雷）。
 *
 * 模板间节点布局不一致（Flux 的 seed/steps/dims 分散在 RandomNoise/BasicScheduler/
 * EmptySD3LatentImage 三节点；SD1.5 全在 KSampler+EmptyLatentImage），本表把这些
 * 差异对模型隐藏成统一的 friendly 名（seed/steps/width/height...）。
 */

export const PARAM_MAPS = {
  // ── 文生图 ──
  sd15_txt2img: {
    prompt: { node: '6', field: 'text' },          // CLIPTextEncode（正向）
    negative_prompt: { node: '7', field: 'text' },  // CLIPTextEncode（负向）
    seed: { node: '3', field: 'seed' },             // KSampler
    steps: { node: '3', field: 'steps' },
    cfg: { node: '3', field: 'cfg' },
    sampler_name: { node: '3', field: 'sampler_name' },
    scheduler: { node: '3', field: 'scheduler' },
    width: { node: '5', field: 'width' },           // EmptyLatentImage
    height: { node: '5', field: 'height' },
    batch_size: { node: '5', field: 'batch_size' },
    model: { node: '4', field: 'ckpt_name' },       // CheckpointLoaderSimple
  },

  // SDXL 文生图：节点布局同 SD1.5（3 KSampler / 4 ckpt / 5 latent / 6,7 prompt）
  sdxl_txt2img: {
    prompt: { node: '6', field: 'text' },
    negative_prompt: { node: '7', field: 'text' },
    seed: { node: '3', field: 'seed' },
    steps: { node: '3', field: 'steps' },
    cfg: { node: '3', field: 'cfg' },
    sampler_name: { node: '3', field: 'sampler_name' },
    scheduler: { node: '3', field: 'scheduler' },
    width: { node: '5', field: 'width' },
    height: { node: '5', field: 'height' },
    batch_size: { node: '5', field: 'batch_size' },
    model: { node: '4', field: 'ckpt_name' },
  },

  // Flux Dev：SamplerCustomAdvanced 链，参数分散在多节点；仅正向 prompt
  flux_dev_txt2img: {
    prompt: { node: '6', field: 'text' },           // CLIPTextEncode（Flux 仅正向）
    seed: { node: '25', field: 'noise_seed' },      // RandomNoise
    steps: { node: '17', field: 'steps' },          // BasicScheduler
    scheduler: { node: '17', field: 'scheduler' },
    denoise: { node: '17', field: 'denoise' },
    sampler_name: { node: '16', field: 'sampler_name' }, // KSamplerSelect
    width: { node: '27', field: 'width' },          // EmptySD3LatentImage
    height: { node: '27', field: 'height' },
    batch_size: { node: '27', field: 'batch_size' },
    model: { node: '12', field: 'unet_name' },      // UNETLoader
  },

  // ── 图生图 / 局部重绘 / 放大（需输入图）──
  sdxl_img2img: {
    prompt: { node: '6', field: 'text' },
    negative_prompt: { node: '7', field: 'text' },
    seed: { node: '3', field: 'seed' },
    steps: { node: '3', field: 'steps' },
    cfg: { node: '3', field: 'cfg' },
    sampler_name: { node: '3', field: 'sampler_name' },
    scheduler: { node: '3', field: 'scheduler' },
    denoise: { node: '3', field: 'denoise' },       // img2img 去噪强度
    model: { node: '4', field: 'ckpt_name' },
    input_image: { node: '1', field: 'image' },     // LoadImage（值=上传后 server 返回的 filename）
  },

  sdxl_inpaint: {
    prompt: { node: '6', field: 'text' },
    negative_prompt: { node: '7', field: 'text' },
    seed: { node: '3', field: 'seed' },
    steps: { node: '3', field: 'steps' },
    cfg: { node: '3', field: 'cfg' },
    sampler_name: { node: '3', field: 'sampler_name' },
    scheduler: { node: '3', field: 'scheduler' },
    denoise: { node: '3', field: 'denoise' },
    model: { node: '4', field: 'ckpt_name' },
    input_image: { node: '1', field: 'image' },     // LoadImage
    mask_image: { node: '2', field: 'image' },      // LoadImageMask（白色=重绘区）
  },

  upscale_4x: {
    input_image: { node: '1', field: 'image' },     // LoadImage
    model: { node: '2', field: 'model_name' },      // UpscaleModelLoader（4x-UltraSharp.pth 等）
  },

  // ── 视频 ──
  // AnimateDiff：帧数 = EmptyLatentImage 的 batch_size（latent 堆叠成帧序列）
  animatediff_video: {
    prompt: { node: '6', field: 'text' },
    negative_prompt: { node: '7', field: 'text' },
    seed: { node: '3', field: 'seed' },
    steps: { node: '3', field: 'steps' },
    cfg: { node: '3', field: 'cfg' },
    sampler_name: { node: '3', field: 'sampler_name' },
    scheduler: { node: '3', field: 'scheduler' },
    width: { node: '5', field: 'width' },
    height: { node: '5', field: 'height' },
    length: { node: '5', field: 'batch_size' },     // 帧数 → latent batch_size
    frame_rate: { node: '9', field: 'frame_rate' }, // VHS_VideoCombine
    model: { node: '4', field: 'ckpt_name' },
  },

  wan_video_t2v: {
    prompt: { node: '6', field: 'text' },
    negative_prompt: { node: '7', field: 'text' },
    seed: { node: '3', field: 'seed' },
    steps: { node: '3', field: 'steps' },
    cfg: { node: '3', field: 'cfg' },
    sampler_name: { node: '3', field: 'sampler_name' },
    scheduler: { node: '3', field: 'scheduler' },
    width: { node: '40', field: 'width' },          // EmptyHunyuanLatentVideo
    height: { node: '40', field: 'height' },
    length: { node: '40', field: 'length' },
    frame_rate: { node: '9', field: 'frame_rate' },
    model: { node: '37', field: 'unet_name' },      // UNETLoader（wan2.1_t2v_1.3B...）
  },
}

/** 某个 preset 是否需要输入图（img2img/inpaint/upscale） */
export function presetNeedsInputImage(preset) {
  const m = PARAM_MAPS[preset] || {}
  return !!(m.input_image)
}

/** 某个 preset 是否需要蒙版图（仅 inpaint） */
export function presetNeedsMask(preset) {
  const m = PARAM_MAPS[preset] || {}
  return !!(m.mask_image)
}
