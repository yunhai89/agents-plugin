/**
 * 图片识别公共出口（A 方案：视觉识别 → 主模型回答）。
 *
 * 用法（apps 层）：
 *   import { VisionService, describeImages } from '../model/vision/index.js'
 *   const vision = new VisionService({ provider, model, protocol })
 *   // 主模型不支持视觉时，把收集到的图片转成文本描述：
 *   const described = await describeImages(vision, files, userQuestion)
 *   media.replaceActive(described)   // 再走 buildContent → 主模型拿到的是描述文本
 */

import { VisionService, DEFAULT_DESCRIBE } from './client.js'
import { isImage } from '../media/resolve.js'

/**
 * 把 mediaList 中的图片逐张交视觉模型识别，替换为携带描述文本的"伪文本媒体"。
 * 非图片媒体原样保留（交由主模型路径按能力降级）。
 *
 * @param {VisionService} vision
 * @param {MediaFile[]} mediaList 收集到的媒体（需已 resolve 出 buffer/mime）
 * @param {string} question 用户当前问题（引导识别重点）
 * @returns {Promise<MediaFile[]>} 转换后的媒体列表（图片 → 文本）
 */
export async function describeImages(vision, mediaList, question) {
  if (!vision || !Array.isArray(mediaList)) return mediaList || []
  const out = []
  for (const mf of mediaList) {
    const img = mf.kind === 'image' || isImage(mf.mime)
    if (img && mf.buffer) {
      let desc = ''
      try {
        desc = await vision.recognize({ buffer: mf.buffer, mime: mf.mime, name: mf.name }, { question })
      } catch (e) {
        desc = ''
      }
      const label = mf.name ? `[图片 ${mf.name}]` : '[图片]'
      const text = desc ? `${label}：${desc}` : `${label}（识别失败/为空）`
      // 替换为文本载体媒体：buildContent 非视觉路径会按 text/plain 抽取为文本
      out.push({
        ...mf,
        kind: 'file',
        mime: 'text/plain',
        ext: 'txt',
        buffer: Buffer.from(text),
        bytes: Buffer.byteLength(text),
        resolveError: undefined,
        __visionDescribed: true,
      })
    } else {
      out.push(mf)
    }
  }
  return out
}

export { VisionService, DEFAULT_DESCRIBE }
