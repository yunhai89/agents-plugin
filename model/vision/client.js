/**
 * 图片识别服务（视觉子模型）—— A 方案的核心：把图片转成详尽文本描述，喂给（可能不支持视觉的）主模型。
 *
 * 工作方式：用配置好的视觉 provider 发一条"单轮多模态"请求（图片 + 描述指令 + 可选用户问题），
 * 取模型返回的文本作为该图的描述。失败不抛错，返回空串/降级文本，保证主流程不中断。
 *
 * 库解耦：provider + model + protocol 注入；content 构造复用 model/media/convert.buildUserContent，
 * 自动按协议（OpenAI image_url / Anthropic image block）产出原生块。
 */

import { buildUserContent } from '../media/convert.js'

/** 默认"描述这张图"指令：尽量榨取 OCR / 物体 / 图表 / 关键信息，供下游文本模型使用 */
export const DEFAULT_DESCRIBE = [
  '请详细描述这张图片，供一个看不到图的文本 AI 阅读并回答用户问题。要求：',
  '1) 若图中有文字（截图/文档/招牌/字幕），逐字转写（OCR）；',
  '2) 说明图片主体、场景、显著物体与布局；',
  '3) 若是图表/表格，转述关键数据与趋势；',
  '4) 客观陈述，不要臆测未呈现的内容；',
  '5) 控制在 300 字以内，信息密度高、可直接被引用。',
].join('\n')

export class VisionService {
  constructor({ provider, model, protocol = 'openai', describePrompt, maxTokens = 1024, logger = () => {} } = {}) {
    if (!provider) throw new Error('VisionService 需要 provider')
    if (!model) throw new Error('VisionService 需要 model')
    this.provider = provider
    this.model = model
    this.protocol = protocol
    this.describePrompt = describePrompt || DEFAULT_DESCRIBE
    this.maxTokens = maxTokens
    this.logger = logger
  }

  /**
   * 识别单张图片 → 文本描述。
   * @param {object} image { buffer:Buffer, mime:string, name?:string }
   * @param {object} opts { question?:string } 用户当前问题，引导描述重点
   * @returns {Promise<string>} 描述文本；失败返回空串（调用方自行降级）
   */
  async recognize({ buffer, mime, name } = {}, { question } = {}) {
    if (!buffer || !mime) return ''
    const media = [{ name: name || 'image', mime, buffer, bytes: buffer.length, kind: 'image' }]
    const userText = question
      ? `${this.describePrompt}\n\n用户想了解：${question}`
      : this.describePrompt
    const content = buildUserContent(userText, media, { protocol: this.protocol, caps: { vision: true } })

    let res
    try {
      res = await this.provider.chat({
        model: this.model,
        messages: [{ role: 'user', content }],
        max_tokens: this.maxTokens,
        stream: false,
      })
    } catch (e) {
      this.logger('warn', `[vision] 识别失败 ${name || ''}：${e?.message || e}`)
      return ''
    }
    const text = (res?.content || '').trim()
    return text
  }
}
