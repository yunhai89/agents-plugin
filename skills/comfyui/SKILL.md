---
name: comfyui
description: "用 ComfyUI 生成图片/视频：文生图、图生图、局部重绘、放大、视频。调用 comfyui__generate，按 preset 选工作流模板并填 prompt 等参数，生成后自动发图到聊天"
when: [生成图片, 画个, 画一张, 画张, 画个图, 文生图, 图生图, 局部重绘, inpaint, 放大图片, 超分, 超分辨率, 生成视频, 做个视频, comfyui, stable diffusion, stable-diffusion, SDXL, Flux, 扩散模型, AI 画图]
priority: 8
---

# ComfyUI 图像/视频生成

当用户想**生成 / 绘制 / 重绘 / 放大图片**或**生成视频**时，用 **comfyui__generate** 工具。

## 选哪个 preset

| preset | 用途 | 关键参数 | 备注 |
|---|---|---|---|
| `sd15_txt2img` | 文生图（最快，SD1.5） | prompt, seed, steps, width, height | 显存小、快；尺寸用 512×512 / 512×768 |
| `sdxl_txt2img` | 文生图（高质量，SDXL） | prompt, steps, width, height | **通用首选**；尺寸约 1024×1024 |
| `flux_dev_txt2img` | 文生图（最强写实，Flux） | prompt（仅正向）, steps, width, height | **无 negative_prompt**；效果最佳但慢、吃显存 |
| `sdxl_img2img` | 图生图（改风格/重绘） | prompt, input_image, denoise | denoise 0.3-0.8，越高越偏离原图 |
| `sdxl_inpaint` | 局部重绘（只改一块） | prompt, input_image, mask_image, denoise | mask 白色=要重绘区域 |
| `upscale_4x` | 图片放大 4×（增清晰） | input_image | 不改内容只超分 |
| `animatediff_video` | 短视频（SD1.5 基底） | prompt, length(帧数), frame_rate | 输出视频文件 |
| `wan_video_t2v` | 文生视频（Wan2.1，高质量） | prompt, length, width, height | 慢、吃显存 |

## 参数填写要点

- **prompt 用英文最稳**：描述画面 + 风格 + 质量词（如 `masterpiece, highly detailed, cinematic lighting, 8k`）。
- **seed**：留空或负数 = 随机；想复现就填固定整数。生成后会回传 `seed_used`，可复述给用户方便重出。
- **steps**：15-25 够用，超 30 又慢收益又低。
- **尺寸**：SD1.5 用 512 系列；SDXL / Flux 用 1024 系列。视频用 832×480 这类小尺寸。
- **img2img / inpaint / upscale 必须给 `input_image`**：可填用户刚发的图的附件名、图片 URL，或留空（`__last__`）取最近一张。**inpaint 还要 `mask_image`**。
- **model**：覆盖默认 checkpoint/UNet 文件名，必须服务器上已存在；不确定就先调 `comfyui__list_models` 查。

## 流程

1. 不清楚意图时先问用户：写实还是动漫？改图还是新画？要不要视频？（避免选错 preset 白跑一次）
2. 调 `comfyui__generate({ preset, prompt, ... })`。**生成会触发主人 #确认/#拒绝**（每次都消耗 GPU / 费用），属正常门控，不是报错。
3. 工具会把图片**自动发到聊天**，并返回 `{ outputs, seed_used }`。向用户复述 seed 方便复现。
4. 失败时工具返回 `{ error }`（常见：服务不可达 / 模型缺失 / 超时）→ **如实告知**，换 preset 或让用户检查 ComfyUI 服务；不要伪造"已生成"。

## 约束

- **不要伪造结果**：失败就报失败，不要说"生成好了"但没图。
- **控成本**：每次生成消耗 GPU。换参数重试前说明理由，避免无意义重复。
- **NSFW**：按全局策略拒绝生成违规内容。
- 服务未配置时（`comfyui__status` 不可达）：直接告诉用户 ComfyUI 服务没起 / 没配 host，别反复重试。
