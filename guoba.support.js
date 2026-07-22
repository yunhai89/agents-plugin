/**
 * 锅巴插件（Guoba-Plugin）配置面板适配。
 *
 * Guoba 启动时会扫描各插件目录下的 guoba.support.js，调用导出的 supportGuoba()，
 * 用返回的 schemas 渲染 Web 配置面板。前端点「确定」后调用 setConfigData，
 * 我们把改动合并进 Config 并保存——Config 的 fs.watch 会自动热加载（无需重启 Yunzai）。
 *
 * 适配契约（Guoba-Plugin v1.4.2）：
 *   getConfigData()        返回配置对象，schemas 的 field 用「点路径」从中取值展示
 *   setConfigData(data,{Result})  data = { 'agent.model': value, ... } 点路径映射；持久化后 Result.ok()
 *   component: SOFT_GROUP_BEGIN(分组) / Input / InputTextArea / InputNumber / Switch / Select
 *   Select: componentProps: { options: [{label, value}] }
 */
import Config from './utils/Config.js'
import Log from './utils/Log.js'

/** 按点路径写入嵌套对象（不引 lodash） */
function setPath(obj, path, value) {
  const keys = String(path).split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = value
}

// 常用选项集
const OPT = {
  trigger: [
    { label: '@机器人触发', value: 'at' },
    { label: '触发词触发', value: 'command' },
    { label: '两者皆可', value: 'both' },
  ],
  bool: [
    { label: '开', value: true },
    { label: '关', value: false },
  ],
  protocol: [
    { label: 'OpenAI 兼容', value: 'openai' },
    { label: 'Anthropic 兼容', value: 'anthropic' },
  ],
  preset: [
    { label: 'DeepSeek', value: 'deepseek' },
    { label: 'OpenAI', value: 'openai' },
    { label: 'Gemini', value: 'gemini' },
    { label: '通义(DashScope)', value: 'dashscope' },
    { label: '智谱', value: 'zhipu' },
    { label: 'Kimi(Moonshot)', value: 'moonshot' },
    { label: '小米(MiMo)', value: 'mimo' },
    { label: 'Anthropic', value: 'anthropic' },
  ],
  permission: [
    { label: '仅主人', value: 'master' },
    { label: '管理员', value: 'admin' },
    { label: '群主', value: 'owner' },
    { label: '所有人', value: 'all' },
  ],
  guardAction: [
    { label: '拦截(block)', value: 'block' },
    { label: '隔离标注(flag)', value: 'flag' },
    { label: '脱敏(sanitize)', value: 'sanitize' },
  ],
  guardSensitivity: [
    { label: '低(0.95)', value: 'low' },
    { label: '中(0.7)', value: 'medium' },
    { label: '高(0.5)', value: 'high' },
  ],
}

// 支持锅巴
export function supportGuoba() {
  return {
    pluginInfo: {
      name: 'agents-plugin',
      title: 'AI Agents 插件',
      description: '多模型对话 · 工具调用 · 长期记忆 · 人设 · 多模态 · 深度研究 · MCP · 群管 · 终端',
      author: ['云汐'],
      authorLink: ['https://github.com/'],
      link: 'https://github.com/',
      isV3: true,
      isV2: false,
      showInMenu: 'auto',
      icon: 'mdi:robot-outline',
      iconColor: '#3b82f6',
    },
    configInfo: {
      schemas: [
        // —— 基础 ——
        { label: '基础设置', component: 'SOFT_GROUP_BEGIN' },
        { field: 'debug', label: '调试日志', bottomHelpMessage: '打印工具入参/每轮 token/搜索词等，排查时开启', component: 'Switch' },
        { field: 'agent.trigger', label: '触发模式', component: 'Select', componentProps: { options: OPT.trigger } },
        { field: 'agent.triggerCommand', label: '触发词', bottomHelpMessage: 'trigger 为 command/both 时生效，如 #ai', component: 'Input', componentProps: { placeholder: '#ai' } },
        { field: 'agent.chatPermission', label: '#ai 命令权限', component: 'Select', componentProps: { options: OPT.permission } },
        { field: 'agent.masters', label: '接收审批通知的 master QQ', bottomHelpMessage: '每行一个 QQ 号', component: 'InputTextArea', componentProps: { placeholder: '每行一个 QQ 号' } },
        { field: 'agent.systemPrompt', label: '默认身份 systemPrompt', bottomHelpMessage: '留空用富默认身份；被人设覆盖时失效', component: 'InputTextArea' },

        // —— 模型 ——
        { label: '模型与对话', component: 'SOFT_GROUP_BEGIN' },
        { field: 'agent.protocol', label: '协议', component: 'Select', componentProps: { options: OPT.protocol } },
        { field: 'agent.preset', label: '厂商预设', bottomHelpMessage: '自动填 baseURL/headers/字段映射', component: 'Select', componentProps: { options: OPT.preset } },
        { field: 'agent.baseURL', label: '自定义 baseURL', bottomHelpMessage: '覆盖 preset', component: 'Input' },
        { field: 'agent.apiKey', label: 'API Key', component: 'Input', componentProps: { placeholder: 'sk-xxx' } },
        { field: 'agent.model', label: '模型 ID', component: 'Input', componentProps: { placeholder: 'deepseek-chat' } },
        { field: 'agent.maxTurns', label: '工具调用轮次上限', component: 'InputNumber', componentProps: { min: 1, max: 100 } },
        { field: 'agent.temperature', label: '采样温度', bottomHelpMessage: '留空=厂商默认', component: 'InputNumber', componentProps: { min: 0, max: 2, step: 0.1 } },
        { field: 'agent.maxTokens', label: '单次回复最大 token', bottomHelpMessage: '留空=厂商默认（Anthropic 默认 4096）', component: 'InputNumber', componentProps: { min: 1 } },

        // —— 上下文与流式 ——
        { label: '上下文与流式', component: 'SOFT_GROUP_BEGIN' },
        { field: 'agent.contextWindow', label: '上下文窗口(token)', bottomHelpMessage: '如 32000；超 80% 自动压缩历史保留首条意图；留空不压缩', component: 'InputNumber', componentProps: { min: 1000 } },
        { field: 'agent.maxToolResultChars', label: '工具结果字符上限', component: 'InputNumber', componentProps: { min: 100 } },
        { field: 'agent.keepReasoning', label: '回灌推理(reasoning)到历史', bottomHelpMessage: '默认关：省 context', component: 'Switch' },
        { field: 'agent.stream', label: '逐字流式输出', bottomHelpMessage: '依赖适配器，不稳；默认关', component: 'Switch' },
        { field: 'agent.progress', label: '工具调用进度消息', bottomHelpMessage: '消除干等；默认开', component: 'Switch' },
        { field: 'agent.reply.mode', label: '回复渲染方式', component: 'Select', componentProps: { options: [{ label: '图片（markdown→精美浅色图，默认）', value: 'image' }, { label: '纯文本', value: 'text' }] } },

        // —— 深度思考 ——
        { label: '深度思考（Thinking）', component: 'SOFT_GROUP_BEGIN' },
        { field: 'agent.thinking.enable', label: '开启深度思考', bottomHelpMessage: 'Anthropic 等支持的扩展思考：模型先思考再作答（更慢、更耗 token，但复杂问题质量更高）', component: 'Switch' },
        { field: 'agent.thinking.budget_tokens', label: '思考预算(tokens)', component: 'InputNumber', componentProps: { min: 1024, max: 64000, step: 1024 } },

        // —— 安全与审批 ——
        { label: '安全与审批', component: 'SOFT_GROUP_BEGIN' },
        { field: 'agent.guardAction', label: '注入防御动作', component: 'Select', componentProps: { options: OPT.guardAction } },
        { field: 'agent.guardSensitivity', label: '防御灵敏度', component: 'Select', componentProps: { options: OPT.guardSensitivity } },
        { field: 'agent.confirmTimeout', label: '审批超时(秒)', component: 'InputNumber', componentProps: { min: 10 } },
        {
          field: 'agent.masterSkipConfirm',
          label: '主人任务免确认【高危】',
          helpMessage: '高危！开启后主人发起的确认类工具（如 terminal 写命令）跳过 #确认 直接执行。',
          bottomHelpMessage: '⚠️ 高危：开启后主人的命令不再审批、直接执行（仅在控制台打印日志，不在聊天提示，防刷屏）。denylist 灾难命令仍硬拦。开启即视为你知晓风险、自担后果。默认关。',
          component: 'Switch',
        },

        // —— 视觉 ——
        { label: '视觉子模型', component: 'SOFT_GROUP_BEGIN' },
        { field: 'agent.vision.enable', label: '启用视觉子模型', bottomHelpMessage: '主模型不支持视觉时，由它把图转文本', component: 'Switch' },
        { field: 'agent.vision.model', label: '视觉模型 ID', component: 'Input', componentProps: { placeholder: 'mimo-2.5' } },
        { field: 'agent.vision.apiKey', label: '视觉模型 API Key', bottomHelpMessage: '空则复用主 apiKey', component: 'Input' },

        // —— 深度研究 ——
        { label: '深度研究', component: 'SOFT_GROUP_BEGIN' },
        { field: 'agent.research.permission', label: '#研究 权限', component: 'Select', componentProps: { options: [{ label: '仅主人(防滥用)', value: 'master' }, { label: '所有人', value: 'all' }] } },
        { field: 'agent.research.maxRounds', label: '最大轮次', component: 'InputNumber', componentProps: { min: 1, max: 10 } },
        { field: 'agent.research.workerModel', label: '子代理模型', bottomHelpMessage: '空则用主模型；可填便宜模型省钱', component: 'Input' },

        // —— ⚠️ 终端(高危) ——
        { label: '⚠️ 终端执行(高危)', component: 'SOFT_GROUP_BEGIN' },
        {
          field: 'agent.terminal.enable',
          label: '启用终端(shell)执行【高危】',
          helpMessage: '高危工具！即使有 allowlist 免审/黑名单/审批等防护，也无法做到 100% 安全。',
          bottomHelpMessage: '⚠️ 高危：shell 可在主机执行任意命令，即便有 allowlist/黑名单/审批等防护也无法保证 100% 安全。开启此项即表示你知晓风险、同意自担后果，与开发者无关；开发者会尽量保证安全性。默认关闭。',
          component: 'Switch',
        },
        { field: 'agent.terminal.maxTimeout', label: '命令超时上限(秒)', component: 'InputNumber', componentProps: { min: 1, max: 3600 } },
      ],
      // 获取配置数据（前端展示）
      getConfigData() {
        const data = JSON.parse(JSON.stringify(Config.get()))
        // masters 数组 → 多行文本（textarea 展示）
        if (Array.isArray(data?.agent?.masters)) data.agent.masters = data.agent.masters.join('\n')
        // thinking：provider 原生 {type,budget_tokens}|null → 面板友好 {enable,budget_tokens}
        const tk = data?.agent?.thinking
        data.agent.thinking = { enable: !!tk && tk?.type !== 'disabled', budget_tokens: tk?.budget_tokens || 16000 }
        return data
      },
      // 保存配置（前端点确定后调用）；合并点路径 → Config.save → 强制热加载
      setConfigData(data, { Result }) {
        const cfg = Config.get()
        // 深度思考：面板 {enable,budget_tokens} → provider 原生 {type:'enabled',budget_tokens}|null
        if ('agent.thinking.enable' in (data || {})) {
          const cur = cfg.agent?.thinking || {}
          const enable = data['agent.thinking.enable']
          const budget = data['agent.thinking.budget_tokens'] ?? cur.budget_tokens ?? 16000
          cfg.agent.thinking = enable ? { type: 'enabled', budget_tokens: Number(budget) || 16000 } : null
          delete data['agent.thinking.enable']
          delete data['agent.thinking.budget_tokens']
        }
        for (const [p, v] of Object.entries(data || {})) {
          let val = v
          if (p === 'agent.masters' && typeof val === 'string') {
            val = val.split('\n').map((s) => String(s).trim()).filter(Boolean)
          }
          if (p === 'agent.masters') val = val.map((x) => String(x))
          setPath(cfg, p, val)
        }
        Config.save(cfg)
        // save 已预更新内存 _data，文件监听的 reload 看不到变化、不会通知；
        // 故显式强制 reload(true) 触发热加载（运行时重建）并打日志。
        Log.mark('[guoba] 已通过锅巴保存配置，触发热加载')
        Config.reload(true)
        return Result.ok({}, '保存成功（已自动热加载，无需重启）')
      },
    },
  }
}
