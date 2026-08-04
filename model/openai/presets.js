/**
 * OpenAI 兼容厂商预设（按各厂商最新官方文档适配）。
 *
 * 每个预设可包含：
 *  - baseURL        API 根地址
 *  - reasoningFields 推理内容候选字段（流式与非流式归一化提取）
 *  - prepareBody(body) 请求体发送前的改写（如厂商参数约束）
 *  - buildURL(client, path) 自定义 URL（如 Azure 的 deployment 路径 + api-version）
 *  - authHeaders(client) 自定义认证头（如 Azure 用 api-key 而非 Bearer）
 *
 * 厂商非标准字段（thinking / enable_thinking / reasoning_effort 等）直接写进请求体即可，无需 extra_body 包裹。
 * DeepSeek / MiMo 还提供 Anthropic 协议端点，见 model/anthropic/presets.js。
 */

export const presets = {
  openai: {
    name: 'openai',
    baseURL: 'https://api.openai.com/v1',
    reasoningFields: [],
  },

  /** DeepSeek（OpenAI 兼容）。模型：deepseek-v4-pro / deepseek-v4-flash
   *  （deepseek-chat / deepseek-reasoner 已于 2026.07.24 废弃）。
   *  Anthropic 协议入口：https://api.deepseek.com/anthropic */
  deepseek: {
    name: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    reasoningFields: ['reasoning_content'],
  },

  gemini: {
    name: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    reasoningFields: ['reasoning'],
  },

  dashscope: {
    name: 'dashscope',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    reasoningFields: ['reasoning_content'],
  },

  zhipu: {
    name: 'zhipu',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    reasoningFields: ['reasoning_content'],
  },

  /** 月之暗面 Kimi（OpenAI 兼容）。
   *  全球：https://api.moonshot.ai/v1 ；中国区：https://api.moonshot.cn/v1
   *  思考模式：body 中 thinking:{type:'enabled'}；返回 reasoning_content。
   *  官方文档未限制 temperature，默认 0.3，本库原样透传。 */
  moonshot: {
    name: 'moonshot',
    baseURL: 'https://api.moonshot.ai/v1',
    reasoningFields: ['reasoning_content', 'reasoning'],
  },

  /** 小米 MiMo（OpenAI 兼容）。
   *  按量付费：https://api.xiaomimimo.com/v1
   *  Token Plan：https://token-plan-cn.xiaomimimo.com/v1（key 以 tp- 开头）
   *  思考模式：body 中 thinking:{type:'enabled'}；返回 reasoning_content。
   *  余额不足返回 402（非重试）。Anthropic 协议入口：https://api.xiaomimimo.com/anthropic */
  mimo: {
    name: 'mimo',
    baseURL: 'https://api.xiaomimimo.com/v1',
    reasoningFields: ['reasoning_content'],
  },

  /**
   * Azure OpenAI：URL 与认证方式异构，需调用方提供
   * resource / deployment / apiVersion，例如：
   *   createClient({ ...presets.azure, apiKey, resource, deployment, apiVersion })
   */
  azure: {
    name: 'azure',
    baseURL: '',
    reasoningFields: [],
    buildURL(client, path) {
      const { resource, deployment, apiVersion } = client
      if (!resource || !deployment) {
        throw new Error('azure 预设需要在 createClient 时提供 resource 与 deployment（可选 apiVersion）')
      }
      const q = apiVersion ? `?api-version=${encodeURIComponent(apiVersion)}` : ''
      return `https://${resource}.openai.azure.com/openai/deployments/${encodeURIComponent(deployment)}${path}${q}`
    },
    authHeaders(client) {
      return { 'api-key': client.apiKey || '' }
    },
  },

  /** OpenRouter（OpenAI 兼容聚合网关：数百模型 + 自动故障转移）。
   *  baseURL: https://openrouter.ai/api/v1；可选 HTTP-Referer / X-Title 头用于排行榜标识。
   *  模型 slug 形如 openai/gpt-4o、anthropic/claude-sonnet-4.5、google/gemini-3-flash-preview；~前缀=latest 别名。
   *  协议层为 OpenAI 兼容（无需独立 provider）；reasoning 字段归一为 reasoning。
   *  可选 client.httpReferer / client.appTitle（经 config 透传）注入排行榜头。 */
  openrouter: {
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    reasoningFields: ['reasoning'],
    authHeaders(client) {
      const h = {}
      if (client.apiKey) h['Authorization'] = `Bearer ${client.apiKey}`
      if (client.httpReferer) h['HTTP-Referer'] = client.httpReferer
      if (client.appTitle) h['X-Title'] = client.appTitle
      return h
    },
  },

  /** OpenCode Zen（OpenAI 兼容 AI 网关：60+ 精选模型，含免费模型）。
   *  baseURL: https://opencode.ai/zen/v1；Bearer apiKey。
   *  模型 ID：glm-5.2 / deepseek-v4-flash / kimi-k2.7-code / claude-sonnet-4.5 / gpt-5.5 等。
   *  端点 /chat/completions（OpenAI 兼容，覆盖 DeepSeek/GLM/Kimi/MiniMax/免费等）。
   *  另有 /messages（Anthropic 兼容，Claude/Qwen）、/responses（GPT/Grok）——选 openai 协议走 chat/completions 即可。 */
  opencode: {
    name: 'opencode',
    baseURL: 'https://opencode.ai/zen/v1',
    reasoningFields: [],
  },
}

export function getPreset(name) {
  const p = presets[name]
  if (!p) throw new Error(`未知厂商预设：${name}`)
  return p
}
