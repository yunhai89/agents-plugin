import plugin from '../../../lib/plugins/plugin.js'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import Config from '../utils/Config.js'
import Log from '../utils/Log.js'
import {
  Agent,
  createProvider,
  ToolRegistry,
  MemoryStore,
  createMemoryTool,
  makeRecallTool,
  SessionStore,
  RecallStore,
  ScheduleStore,
  ConfirmStore,
  nodeScheduleAdapter,
  memoryKv,
  redisKv,
  noteTools,
  clarifyTool,
  speakTool,
  checkInput,
  systemHardening,
  createPolicy,
  buildChatListHtml,
  buildPersonaListHtml,
} from '../model/agent/index.js'
import { presets as openaiPresets } from '../model/openai/index.js'
import { presets as anthropicPresets } from '../model/anthropic/index.js'
import { McpManager } from '../model/mcp/index.js'
import { createMediaService, makeMediaTools } from '../model/media/index.js'
import { detectCapabilities } from '../model/llm/capabilities.js'
import { groupInfoTools, groupManageTools, groupHistoryTools } from '../model/group/index.js'
import { miyousheTools } from '../model/miyoushe/index.js'
import { loadToolPacks } from '../model/toolkit/index.js'
import { createSearchManager, makeSearchTools } from '../model/search/index.js'
import { PersonaStore, PersonaService } from '../model/persona/index.js'
import { VisionService, describeImages } from '../model/vision/index.js'
import { getStickerManager } from '../model/sticker/manager.js'
import { redactSecrets } from '../model/agent/redact.js'
import { SkillRegistry, loadSkillPack, makeSkillTool } from '../model/skill/index.js'
import { buildSituationalContext } from '../model/perception.js'
import { makeTerminalTool, DEFAULT_BLOCKLIST } from '../model/terminal/index.js'
import { calcTool } from '../model/calc/index.js'
import { screenshot, renderReplyImage } from './render.js'

/** 插件根目录（apps/ 的上两级）—— 用于定位 tools/ 自定义工具包目录 */
const PLUGIN_ROOT = path.resolve(path.dirname(pathToFileURL(import.meta.url).pathname), '../..')

// ─── 进度反馈：工具调用时推送节流进度消息，消除"干等几十秒"的僵化感 ───
// 真正的逐字流式依赖 QQ 适配器（icqq/napcat 差异大、编辑消息不稳），故默认只做可靠的进度反馈；
// agent.stream=true 时才让 provider 流式（onDelta 可用，供未来适配器接入）。
const PROGRESS_LABELS = {
  web_search: '🔍 联网搜索',
  ddg: '🔍 联网搜索',
  tavily: '🔍 联网搜索',
  exa: '🔍 联网搜索',
  brave: '🔍 联网搜索',
  perplexity: '🔍 联网搜索',
  skill: '📖 加载技能',
  reload_skills: '🔄 重载技能',
  read_attachment: '📎 读取附件',
  get_group_file: '📎 获取文件',
  list_group_files: '📎 列出文件',
  terminal: '💻 执行命令',
  calculate: '🧮 计算中',
  process: '💻 进程操作',
  group_info: '⚙️ 查群信息',
  group_members: '⚙️ 查成员',
  group_member: '⚙️ 查成员',
  group_kick: '⚙️ 群操作',
  group_mute: '⚙️ 群操作',
  group_mute_all: '⚙️ 群操作',
  group_set_card: '⚙️ 群操作',
  group_set_title: '⚙️ 群操作',
  group_set_admin: '⚙️ 群操作',
  group_set_name: '⚙️ 群操作',
  miyoushe_search: '🎮 查米游社',
}

/**
 * 构造进度反馈回调集合。
 * @param {object} e Yunzai 事件
 * @param {object} opts { progress:bool }
 */
function makeReplyStream(e, { progress = true, recall = 3 } = {}) {
  if (!progress) return {}
  let lastAt = 0
  let lastTool = null
  let count = 0
  const MIN_INTERVAL = 1500 // ms：节流，防刷屏
  const MAX_MSGS = 8 // 单轮最多 8 条进度，防病态循环刷屏
  return {
    onToolStart(tc) {
      if (count >= MAX_MSGS) return
      const now = Date.now()
      const name = tc?.name
      if (!name) return
      // 同工具 5s 内不重复 + 全局节流
      if (name === lastTool && now - lastAt < 5000) return
      if (now - lastAt < MIN_INTERVAL) return
      lastAt = now
      lastTool = name
      count++
      const label = PROGRESS_LABELS[name] || `🔧 调用 ${name}`
      // recallMsg：支持的适配器会在 N 秒后自动撤回进度消息，保持聊天干净；不支持则忽略（agent.progressRecall，默认 3）
      try { e.reply(`${label}…`, false, { recallMsg: recall }) } catch { /* noop */ }
    },
  }
}

/**
 * agents-plugin 对话命令。
 *   触发 AI：艾特机器人（默认）或自定义触发词（agent.trigger: at|command|both + triggerCommand）
 *   #聊天列表 / #进入聊天 <id> / #new          多对话管理
 *   #确认/#拒绝/#待确认（master）              审批
 *   #记忆 / #忘掉 <kw>                         长期记忆
 *   #我的提醒 / #取消提醒 <id>                  提醒
 *   #模型切换 <id>（master）                    切换模型
 *   #启用mcp <名> / #停止mcp <名>（master）     MCP 服务端启停
 *   #mcp（master）                             MCP 状态
 * 主人判定用 Yunzai 原生 permission:'master'（即 e.isMaster / cfg.master）。
 */

let _runtime = null
let _runtimePromise = null // in-flight buildRuntime()，并发安全：多调用方共享同一次构建
const _clearPending = new Map() // userId → 确认清空的时间戳（2 步确认）

function getKv() {
  if (typeof globalThis !== 'undefined' && globalThis.redis) return redisKv(globalThis.redis)
  return memoryKv()
}

async function buildRuntime() {
  const cfg = Config.get().agent || {}
  if (!cfg.apiKey) throw new Error(`未配置 agent.apiKey，请编辑「${Config.path.userConfig}」的 agent.apiKey（注意是 Yunzai 根目录的 config/，不是插件目录里的 default_config）`)

  const protocol = cfg.protocol || 'openai'
  const presetMap = protocol === 'anthropic' ? anthropicPresets : openaiPresets
  const preset = cfg.preset ? presetMap[cfg.preset] : {}
  const provider = createProvider({
    protocol,
    ...preset,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    apiKey: cfg.apiKey,
    model: cfg.model,
    ...(cfg.reasoningFields ? { reasoningFields: cfg.reasoningFields } : {}),
  })

  const memoryDir = path.join(Config.path.yunzai, 'data/agents-plugin/memories')
  const memory = new MemoryStore({ dir: memoryDir })
  const personaDir = path.join(Config.path.yunzai, 'data/agents-plugin/personas')
  const personaStore = new PersonaStore({ dir: personaDir })
  const K = getKv()
  const session = new SessionStore({ kv: K })
  const recall = new RecallStore({ kv: K })
  // confirmTimeout 配置单位是「秒」，ConfirmStore 用「毫秒」，这里换算（默认 300 秒）
  const confirm = new ConfirmStore({ timeout: (cfg.confirmTimeout || 300) * 1000 })
  const scheduler = await nodeScheduleAdapter()
  const schedule = new ScheduleStore({ kv: K, scheduler })
  const persona = new PersonaService({ store: personaStore, kv: K })

  // Skill（说明书 / 指令包）：从 skills/ 目录加载 .md/.js，按用户输入匹配后注入 prompt
  const skills = new SkillRegistry()
  const skillsDir = path.resolve(PLUGIN_ROOT, cfg.skill?.dir || 'skills')
  const userSkills = await loadSkillPack(skillsDir, { logger: Log.tag('skill') })
  for (const s of userSkills) {
    try { skills.register(s) } catch (e) { Log.warn('[skill] 注册失败', s.name, e?.message || e) }
  }

  // 统一搜索：多源自动路由（Tavily/Exa/Perplexity/Brave → SearXNG → DDG 兜底）
  const searchManager = createSearchManager({
    ...(cfg.search || {}),
    fetcher: (typeof fetch !== 'undefined' && fetch) || undefined,
    logger: Log.tag('search'),
  })
  const enabledSearch = searchManager.availableProviders
  if (enabledSearch.length) Log.info('[search] 已启用搜索源：' + enabledSearch.join('、'))

  const tools = new ToolRegistry({ logger: Log.tag('tool') })
    .register(...makeSearchTools(searchManager)) // web_search（多源）+ web_extract
    .register(...noteTools({ kv: K }))
    .register(clarifyTool)
    .register(speakTool) // 多步任务中向用户播报中途进展/思路（避免埋头苦干）
    .register(createMemoryTool(memory))
    .register(makeRecallTool(recall)) // memory_search：模型主动检索长期记忆
    .register(...makeMediaTools())

  // 内置基础工具包：群信息 / 群管 / 米游社
  if (cfg.tools?.builtin !== false) {
    tools
      .register(...groupInfoTools)
      .register(...groupManageTools)
      .register(...groupHistoryTools) // get_chat_history：模型按需拉群聊近期记录（被动找回）
      .register(...miyousheTools)
  }

  // 自定义工具包：扫描插件根 tools/ 目录自动加载（TRSS-Yunzai apps 风格）
  const toolsDir = path.resolve(PLUGIN_ROOT, cfg.tools?.dir || 'tools')
  const loaded = await loadToolPacks(toolsDir, { logger: Log.tag('toolkit') })
  for (const t of loaded.tools) {
    try { tools.register(t) } catch (e) { Log.warn('[toolkit] 注册失败', t.name, e?.message || e) }
  }
  if (loaded.packs.length) Log.info('[toolkit] 已加载工具包：', loaded.packs.map((p) => `${p.name}(${p.count})`).join(', '))

  // 终端执行能力（危险，默认关；开启后每条命令在调度层强制主人确认 + 黑名单）
  if (cfg.terminal?.enable) {
    tools.register(makeTerminalTool())
    Log.info('[terminal] 已启用终端执行工具（每条命令需主人 #确认）')
  }

  // Python 精确计算工具（数学/统计等；沙箱内执行，默认开）
  if (cfg.calc?.enable !== false) tools.register(calcTool)

  // skill 工具：模型主动调用 skill 的通道（按 name 加载说明书正文）—— 渐进式披露的载入入口
  tools.register(makeSkillTool(skills))

  // 技能热加载工具：安装 SkillHub 技能后免重启即可用
  tools.register({
    name: 'reload_skills',
    description: '重新扫描技能目录(skills/)并加载新技能。用 skillhub/手动安装技能后调用，免去重启。',
    category: 'system',
    meta: { alwaysConfirm: true, interactive: true },
    parameters: { type: 'object', properties: {} },
    async execute() {
      const fresh = await loadSkillPack(skillsDir, { logger: Log.tag('skill') })
      skills.skills.clear()
      skills.register(...fresh)
      return { ok: true, count: skills.list().length, skills: skills.list().map((s) => s.name) }
    },
  })

  const mcp = new McpManager({ registry: tools, logger: Log.tag('mcp'), requestTimeout: cfg.mcp?.requestTimeout })
  mcp.start(cfg.mcp?.servers || {}).catch((e) => Log.error('[mcp] 启动失败', e?.message || e))

  const agent = new Agent({
    provider,
    model: cfg.model,
    tools,
    memory,
    session,
    recall,
    skills, // 让 Agent 在 system prompt 注入 <available_skills> 目录
    guard: { checkInput, systemHardening },
    guardAction: cfg.guardAction || 'flag',
    guardSensitivity: cfg.guardSensitivity || 'medium',
    policy: createPolicy({ categoryMin: cfg.policy?.categoryMin }),
    confirm, // ConfirmStore 审批器：需确认的工具（terminal 写命令等）经它走主人 #确认/#拒绝
    masterSkipConfirm: cfg.masterSkipConfirm === true, // 主人任务免确认直执行（高危，仅主人；denylist 仍拦）
    // 留空时由 Agent 用富默认身份（model/prompt TEMPLATES.agent.system）；人设经 run opts.systemPrompt 覆盖
    systemPrompt: cfg.systemPrompt || undefined,
    maxTurns: cfg.maxTurns ?? 50,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens || null, // 控制输出长度（消除 Anthropic 硬编码 4096 / OpenAI 不发）
    thinking: cfg.thinking || null,
    // 上下文管理：token 压力阈值（从 contextWindow 派生）、工具结果上限、是否回灌 reasoning
    contextPressureThreshold: cfg.contextPressureThreshold ?? (cfg.contextWindow ? Math.floor(cfg.contextWindow * 0.8) : null),
    maxToolResultChars: cfg.maxToolResultChars ?? 4000,
    keepReasoning: cfg.keepReasoning === true,
    reflect: cfg.reflect ?? 'auto',
    reflectMaxIterations: cfg.reflectMaxIterations ?? 1,
    stickers: getStickerManager({ logger: Log.tag('sticker') }), // 表情包清单注入（_assembleSystem 用 catalog()）
    logger: Log.tag('agent'),
  })

  // 视觉子模型（A 方案）：主模型不支持视觉时，由它把图片转成文本描述喂给主模型
  let vision = null
  if (cfg.vision?.enable !== false && cfg.vision?.model) {
    try {
      const vcfg = cfg.vision
      const vProtocol = vcfg.protocol || protocol
      const vPresetMap = vProtocol === 'anthropic' ? anthropicPresets : openaiPresets
      const vPreset = vcfg.preset ? vPresetMap[vcfg.preset] : preset
      const vProvider = createProvider({
        protocol: vProtocol,
        ...vPreset,
        ...(vcfg.baseURL ? { baseURL: vcfg.baseURL } : {}),
        apiKey: vcfg.apiKey || cfg.apiKey,
        model: vcfg.model,
      })
      vision = new VisionService({
        provider: vProvider,
        model: vcfg.model,
        protocol: vProtocol,
        describePrompt: vcfg.describePrompt || undefined,
        maxTokens: vcfg.maxTokens || 1024,
        logger: Log.tag('vision'),
      })
    } catch (e) {
      Log.warn('[vision] 视觉子模型装配失败，主模型不支持视觉时图片将降级', e?.message || e)
    }
  }

  return { agent, session, recall, memory, confirm, schedule, mcp, provider, persona, personaStore, vision, skills, skillsDir, sticker: getStickerManager(), kv: K }
}

async function getRuntime() {
  if (_runtime) return _runtime
  // 并发安全：启动期各 apps 构造器 / 首条消息可能并发调 getRuntime，
  // 复用同一个 in-flight buildRuntime()，避免运行时被构建多次（否则 MCP 会重复连接注册、日志打两遍）。
  if (!_runtimePromise) {
    _runtimePromise = buildRuntime()
      .then((rt) => { _runtime = rt; return rt })
      .catch((e) => { _runtimePromise = null; throw e })
      .finally(() => { _runtimePromise = null })
  }
  return _runtimePromise
}

/** 失效运行时单例（下一次 getRuntime 用新配置重建） */
function invalidateRuntime() {
  _runtime = null
  _runtimePromise = null
}

// 热加载：配置文件变更 → 失效运行时单例，下次对话用新配置重建（无需重启框架）
Config.onChange(() => {
  invalidateRuntime()
  Log.info('[config] 配置已热加载，运行时将在下次对话重建')
})

// 供 apps/research.js 等复用已装配的 provider / 工具集
export { getRuntime }

function ctxOf(e) {
  const isMaster = !!e.isMaster
  let role = 'member'
  if (e.member?.is_owner) role = 'owner'
  else if (e.member?.is_admin) role = 'admin'
  return {
    role,
    isMaster,
    userId: String(e.user_id),
    groupId: e.group_id ? String(e.group_id) : null,
    isGroup: !!e.isGroup,
    isGroupAdmin: !!(e.member?.is_admin || e.member?.is_owner),
    notify: (id, info) => notifyMaster(e, id, info),
    conversationId: null,
    // 媒体被动工具（list_group_files/get_group_file/read_attachment）需读取实时事件与 Bot 句柄
    e,
    bot: (typeof Bot !== 'undefined' && Bot) || null,
    fetcher: (typeof fetch !== 'undefined' && fetch) || null,
  }
}

function notifyMaster(e, id, info) {
  const masters = Config.get().agent?.masters || []
  let detail = JSON.stringify(info.args || {}).slice(0, 120)
  let risk = ''
  if (info.tool === 'terminal' && info.args?.command) {
    detail = `\n$ ${info.args.command}`.slice(0, 500)
    // 风险特征提示（写入/网络/提权/删除/安装）
    const c = info.args.command
    if (/\b(rm|mv|chmod|chown|mkfs|dd|shutdown|reboot|halt)\b|>\s*/i.test(c)) risk = ' ⚠️写入/破坏'
    else if (/\b(curl|wget|ssh|scp|rsync|git\s+push|git\s+clone)\b|https?:\/\//i.test(c)) risk = ' 🌐网络'
    else if (/\bsudo\b|\bsu\b/i.test(c)) risk = ' 🔐提权'
    else if (/\b(install|pip|npm|apt|yum|brew)\b/i.test(c)) risk = ' 📦安装'
  }
  const text = `待审批 #${id}：${info.tool}${risk} ${detail}\n回复「#确认 ${id}」或「#拒绝 ${id}」`
  try {
    for (const mid of masters) {
      const bot = (typeof Bot !== 'undefined' && Bot) || null
      bot?.pickFriend?.(mid)?.sendMsg?.(text)
    }
    if (!masters.length && e.isGroup) e.reply('⚠️ 有动作待审批，但未配置 master 接收通知（agent.masters）')
  } catch (err) {
    Log.warn('notifyMaster 失败', err?.message || err)
  }
}

async function fireReminder(info) {
  try {
    const bot = (typeof Bot !== 'undefined' && (Bot[info.selfId] || Bot)) || null
    const text = `⏰ 提醒：${info.message}`
    if (info.groupId && bot?.pickGroup) await bot.pickGroup(info.groupId).sendMsg(text)
    else if (bot?.pickFriend) await bot.pickFriend(info.userId).sendMsg(text)
  } catch (err) {
    Log.warn('fireReminder 失败', err?.message || err)
  }
}

// #添加mcp 交互式监听：私聊下记录"待接收 mcpServers JSON"的用户（带 TTL 防卡死；进程重启清空）
const MCP_ADD_PENDING_TTL = 120000 // 2 分钟
const mcpAddPending = new Map() // userId(String) -> { at }

export class Chat extends plugin {
  constructor() {
    super({
      name: 'agents对话',
      dsc: 'AI Agent 对话（多轮/工具/记忆/安全/审批/MCP）',
      event: 'message',
      priority: 9999,
      rule: [
        // —— 主人指令 ——
        { reg: '^#启用mcp\\s+(.+)', fnc: 'enableMcp', permission: 'master' },
        { reg: '^#停止mcp\\s+(.+)', fnc: 'disableMcp', permission: 'master' },
        { reg: '^#模型切换\\s+(.+)', fnc: 'switchModel', permission: 'master' },
        { reg: '^#确认\\s*(\\d+)', fnc: 'approve', permission: 'master' },
        { reg: '^#拒绝\\s*(\\d+)', fnc: 'reject', permission: 'master' },
        { reg: '^#待确认$', fnc: 'pending', permission: 'master' },
        { reg: '^#mcp$', fnc: 'mcpStatus', permission: 'master' },
        { reg: '^#添加[Mm][Cc][Pp]', fnc: 'addMcp', permission: 'master' },
        { reg: '^#agents重载$', fnc: 'agentsReload', permission: 'master' },
        // —— 所有用户 ——
        { reg: '^#聊天列表$', fnc: 'chatList' },
        { reg: '^#进入聊天\\s*(\\d+)', fnc: 'enterChat' },
        { reg: '^#new$', fnc: 'newChat' },
        { reg: '^#记忆$', fnc: 'showMemory' },
        { reg: '^#忘掉\\s+(.+)', fnc: 'forget' },
        { reg: '^#我的提醒$', fnc: 'myReminders' },
        { reg: '^#取消提醒\\s*(\\d+)', fnc: 'cancelReminder' },
        { reg: '^#清空所有记录$', fnc: 'clearMyData' },
        // —— 人设 ——（更具体的规则在前，避免被 #人设+id 吞掉）
        { reg: '^#人设列表$', fnc: 'personaList' },
        { reg: '^#人设详情\\s+(.+)', fnc: 'personaDetail' },
        { reg: '^#新建人设\\s+(.+)', fnc: 'personaCreate' },
        { reg: '^#删除人设\\s+(.+)', fnc: 'personaDelete' },
        { reg: '^#重置人设$', fnc: 'personaReset' },
        { reg: '^#人设$', fnc: 'personaList' },
        { reg: '^#人设\\s+(.+)', fnc: 'personaSwitch' },
        // —— AI 触发（catch-all，最后匹配；@或自定义触发词）——
        { reg: '^[\\s\\S]+$', fnc: 'onTrigger', log: false },
      ],
    })
    getRuntime()
      .then((rt) => rt.schedule.restore(fireReminder).catch(() => {}))
      .catch((e) => Log.error('agent 初始化失败', e?.message || e))
  }

  // —— AI 触发 ——
  async onTrigger() {
    // #添加mcp 交互式监听：私聊下，待接收 JSON 的用户，本条消息当作 mcpServers 配置处理
    const __uid = String(this.e.user_id)
    if (!this.e.isGroup && mcpAddPending.has(__uid)) {
      const p = mcpAddPending.get(__uid)
      if (Date.now() - p.at > MCP_ADD_PENDING_TTL) mcpAddPending.delete(__uid) // 超时自清
      else return this._consumeMcpAddJson(this.e.msg)
    }
    const cfg = Config.get().agent || {}
    const mode = cfg.trigger || 'at' // at | command | both
    const cmd = cfg.triggerCommand || '#ai'
    const text = (this.e.msg || '').trim()
    const atMode = mode !== 'command'
    const cmdMode = mode !== 'at'
    const isAt = !!this.e.atBot
    const cmdRe = new RegExp(`^${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`)
    const isCmd = cmdMode && cmdRe.test(text)
    if (!((atMode && isAt && text) || isCmd)) return false
    const input = isCmd ? text.replace(cmdRe, '').trim() : text
    if (!input) return false
    Log.mark('[trigger]', `user=${this.e.user_id} gid=${this.e.group_id || '-'} mode=${isCmd ? 'cmd' : 'at'} inputLen=${input.length}`)
    return this._handleAgent(input)
  }

  async _handleAgent(text) {
    let rt
    try {
      rt = await getRuntime()
    } catch (e) {
      await this.e.reply(String(e?.message || e))
      return true
    }
    const cfg = Config.get().agent || {}
    const ctx = ctxOf(this.e)
    ctx.conversationId = await rt.session.getActiveConversation(ctx.userId)

    // —— 多模态：主动收集消息中的图片/文件，按模型能力转为协议原生内容 ——
    const protocol = cfg.protocol || 'openai'
    const caps = detectCapabilities({ protocol, model: cfg.model, caps: cfg.media?.caps })
    const mediaCfg = cfg.media || {}
    ctx.miyoushe = { cookie: cfg.miyoushe?.cookie || '', defaultGid: cfg.miyoushe?.defaultGid || 2 }
    // terminal 工具运行时配置（黑名单/超时/工作目录）
    ctx.terminal = {
      cwd: Config.path.yunzai,
      maxTimeout: cfg.terminal?.maxTimeout || 600,
      blocklist: cfg.terminal?.blocklist || DEFAULT_BLOCKLIST,
    }
    const media = createMediaService({
      bot: ctx.bot, e: this.e, caps, protocol, config: mediaCfg, fetcher: ctx.fetcher,
      log: (m) => (/失败|未能|异常/.test(m) ? Log.warn('[media]', m) : Log.debug('[media]', m)),
    })
    let input = text
    try {
      let files = await media.collectActive()
      const nImg = files.filter((f) => f.kind === 'image' || (f.mime || '').startsWith('image/')).length
      // A 方案：主模型不支持视觉时，由视觉子模型把图片转成文本描述，再喂给主模型
      if (!caps.vision && rt.vision && nImg > 0) {
        Log.mark('[chat]', `vision 子模型识别 ${nImg} 张图（主模型 ${cfg.model} 无视觉）`)
        try {
          files = await describeImages(rt.vision, files, text)
          media.replaceActive(files)
        } catch (e) {
          Log.warn('[vision] 图片识别失败，按原能力降级', e?.message || e)
        }
      }
      ctx.media = files // 供 read_attachment 等被动工具读取
      const content = media.buildContent(text)
      if (Array.isArray(content)) input = { role: 'user', content, _media: true }
      if (files.length) Log.debug('[chat]', `media files=${files.length} images=${nImg} vision=${!!caps.vision} multimodal=${Array.isArray(content)}`)
    } catch (e) {
      Log.warn('[media] 主动收集失败，回退纯文本', e?.message || e)
    }

    // —— 人设：解析当前用户激活的人设，覆盖身份层 systemPrompt ——
    let systemPrompt
    let personaId = null
    try {
      const { persona } = await rt.persona.resolve(ctx.userId)
      systemPrompt = persona?.systemPrompt || undefined
      personaId = persona?.id || null
    } catch (e) {
      Log.warn('[persona] 解析失败，用默认', e?.message || e)
    }

    // —— 情境感知：perception（数据：时间/角色/自我状态/近期对话）+ skill（说明书，按输入匹配）——
    let context
    try {
      // 会话历史条数：供 perception 判断"上下文稀薄 → 主动补全近期群聊"（复用 session 缓存，零额外读盘）
      let sessionLen
      try { sessionLen = await rt.session.historyLength(ctx) } catch { sessionLen = undefined }
      const perception = await buildSituationalContext({
        ctx, runtime: rt, e: this.e, kv: rt.kv, cfg, bot: ctx.bot,
        historyCount: cfg.skill?.historyCount ?? 15,
        sessionLen,
      })
      const matched = rt.skills.match({ input: text, ctx })
      const skillText = rt.skills.assemble(matched)
      if (matched.length) Log.mark('[skill]', '命中说明书：', matched.map((s) => s.name).join(','))
      context = [perception, skillText].filter(Boolean).join('\n\n') || undefined
    } catch (e) {
      Log.warn('[perception/skill] 注入失败', e?.message || e)
    }

    Log.mark('[chat]', `user=${ctx.userId} gid=${ctx.groupId || '-'} conv=${ctx.conversationId} model=${cfg.model} persona=${personaId || 'default'} vision=${caps.vision ? 'on' : 'off'} thinking=${cfg.thinking ? 'on' : 'off'}${context ? ` ctx=${String(context).length}字` : ''}`)
    const wantProgress = cfg.progress !== false
    const wantStream = cfg.stream === true // 逐字流式默认关（适配器差异大）；进度反馈默认开
    if (wantProgress) await this.e.reply('思考中…')
    const rs = makeReplyStream(this.e, { progress: wantProgress, recall: cfg.progressRecall ?? 3 })
    try {
      const { content, stopReason, turns, usage } = await rt.agent.run(input, {
        ctx, systemPrompt, context,
        stream: wantStream,
        ...(rs.onToolStart ? { onToolStart: rs.onToolStart } : {}),
        // OpenClaw 式中途播报：模型在调工具时附带的中途文本（思路/进展）实时转发给用户，不丢弃
        onAssistant: (res) => {
          if (res?.toolCalls?.length && res?.content && cfg.reply?.narrate !== false) {
            try { this.e.reply(redactSecrets(res.content)) } catch { /* noop */ }
          }
        },
      })
      const u = usage ? `in:${usage.prompt_tokens ?? usage.input_tokens ?? usage.input ?? '-'}/out:${usage.completion_tokens ?? usage.output_tokens ?? usage.output ?? '-'}` : '-'
      Log.mark('[chat]', `reply turns=${turns} stop=${stopReason} usage=${u} replyLen=${(content || '').length}`)
      // 发送前脱敏：屏蔽 API Key / token 等敏感信息（agent.redactSecrets 默认开；异常不阻塞回复）
      const body = cfg.redactSecrets === false ? (content || '') : redactSecrets(content || '')
      const suffix = stopReason === 'max_turns' ? '（已达工具调用上限）' : ''
      // 表情包：本轮一次性门控（决定带哪些图 + 记冷却/防连发/usage），图片/文本模式共用结果，避免双计
      const acceptMap = (rt.sticker && body) ? rt.sticker.decide(body, ctx) : null
      // 群聊回复艾特发言人（agent.reply.atSender，默认开；私聊不艾特）
      const atSender = (ctx.isGroup && cfg.reply?.atSender !== false && ctx.userId && typeof segment !== 'undefined') ? segment.at(ctx.userId) : null
      // 回复渲染：默认图片（markdown→图片，失败退文本）；agent.reply.mode: text 可关
      const replyMode = cfg.reply?.mode || 'image'
      let delivered = false
      if (replyMode === 'image' && body) {
        try {
          const sc = acceptMap ? rt.sticker.applyImage(body, acceptMap) : body
          const img = await renderReplyImage(sc)
          if (img) { await this.e.reply(atSender ? [atSender, img] : img); delivered = true }
        } catch (e) { Log.warn('[render] 回复图片渲染失败，回退文本', e?.message || e) }
      }
      if (!delivered) {
        // 文本模式（或图片渲染失败）：表情包混排（无图→纯文本；有图→segment 数组）
        const seg = acceptMap ? rt.sticker.applyText(body, acceptMap) : (body || '(无回复)')
        if (typeof seg === 'string') {
          const txt = `${seg}${suffix ? `\n${suffix}` : ''}`
          await this.e.reply(atSender ? [atSender, txt] : txt)
        } else {
          await this.e.reply(atSender ? [atSender, ...seg] : seg)
          if (suffix) await this.e.reply(suffix)
        }
      } else if (suffix) {
        await this.e.reply(suffix) // 图片已发，max_turns 提示作附注
      }
      // 记录群内最近活跃时间，供 perception 判断"久未发言补课"
      if (ctx.isGroup && ctx.groupId && rt.kv) {
        rt.kv.set(`perception:last_active:${ctx.groupId}`, { at: Date.now() }).catch(() => {})
      }
    } catch (e) {
      Log.error('[chat] agent 失败', e?.message || e)
      await this.e.reply(redactSecrets(`失败：${e?.message || e}`))
    }
    return true
  }

  // —— 多对话 ——
  async chatList() {
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    const list = await rt.session.listConversations(ctx.userId)
    const activeId = await rt.session.getActiveConversation(ctx.userId)
    const html = buildChatListHtml({ user: ctx.userId, conversations: list, activeId })
    const img = await screenshot('agents-plugin/chat-list', html)
    if (img) return this.e.reply(img), true
    const lines = list.map((c) => `#${c.id} ${c.title}（${c.count}条）${c.id === activeId ? ' [当前]' : ''}`)
    await this.e.reply(['聊天列表', ...lines].join('\n'))
    return true
  }

  async enterChat() {
    const id = this.e.msg.match(/\d+/)?.[0]
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    const ok = await rt.session.setActiveConversation(ctx.userId, id)
    await this.e.reply(ok ? `已切换到对话 #${id}` : `未找到对话 #${id}，发送 #聊天列表 查看`)
    return true
  }

  async newChat() {
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    const conv = await rt.session.createConversation(ctx.userId)
    await this.e.reply(`已新建对话 #${conv.id}（${conv.title}），后续消息在此对话中继续`)
    return true
  }

  // —— 模型切换 ——
  async switchModel() {
    const id = this.e.msg.replace(/^#模型切换\s+/, '').trim()
    const rt = await getRuntime()
    rt.agent.model = id
    try {
      const c = Config.get()
      if (!c.agent) c.agent = {}
      c.agent.model = id
      Config.save()
    } catch (e) {
      Log.warn('模型切换持久化失败', e?.message || e)
    }
    await this.e.reply(`已切换模型：${id}`)
    return true
  }

  // —— MCP 启停 ——
  async enableMcp() {
    const name = this.e.msg.replace(/^#启用mcp\s+/, '').trim()
    const rt = await getRuntime()
    const cfg = Config.get().agent?.mcp?.servers?.[name]
    if (!cfg) return this.e.reply(`未在配置中找到 MCP 服务端：${name}`), true
    await rt.mcp.add(name, cfg)
    const s = rt.mcp.status()[name]
    await this.e.reply(s?.status === 'connected' ? `已启用 ${name}（${s.tools} 个工具）` : `启用 ${name} 失败：${s?.error || ''}`)
    return true
  }

  async disableMcp() {
    const name = this.e.msg.replace(/^#停止mcp\s+/, '').trim()
    const rt = await getRuntime()
    await rt.mcp.remove(name)
    await this.e.reply(`已停止 ${name}`)
    return true
  }

  // —— 添加 MCP（标准 mcpServers JSON）→ 连接验证 → 成功则持久化 ——
  // 两种用法：① #添加mcp <JSON> 一行带配置（任意会话）；
  //          ② 私聊发 #添加mcp（不带 JSON）进入监听，下一条消息当作 JSON 处理（onTrigger 拦截），处理一次即结束。
  //          群聊不带 JSON 只显示用法（群聊不开监听，避免群消息被吞）。
  async addMcp() {
    const body = this.e.msg.replace(/^#添加mcp\b\s*/i, '').trim()
    if (!body) {
      if (!this.e.isGroup) {
        // 私聊：进入交互式监听，等下一条消息作为 mcpServers JSON
        mcpAddPending.set(String(this.e.user_id), { at: Date.now() })
        await this.e.reply([
          '📝 已进入添加 MCP 模式，请直接发送 mcpServers JSON 配置。',
          '支持 Claude Desktop / Z.AI 标准格式，例如：',
          '```json',
          '{ "mcpServers": { "zai": { "type": "stdio", "command": "npx", "args": ["-y","@z_ai/mcp-server"], "env": { "Z_AI_API_KEY": "xxx" } } } }',
          '```',
          '收到后会立即连接验证；成功则写入配置（持久化、热加载），失败会报错。',
          `（${MCP_ADD_PENDING_TTL / 1000} 秒内有效；处理一次即结束）`,
        ].join('\n'))
        return true
      }
      // 群聊：不开启监听（避免群消息被吞），提示用一行带 JSON 的方式或去私聊
      await this.e.reply([
        '用法：#添加mcp <mcpServers JSON>',
        '或私聊发送 #添加mcp 进入交互式添加（直接粘贴 JSON 即可）。',
        '示例：',
        '```json',
        '{ "mcpServers": { "zai": { "type": "stdio", "command": "npx", "args": ["-y","@z_ai/mcp-server"], "env": { "Z_AI_API_KEY": "xxx" } } } }',
        '```',
      ].join('\n'))
      return true
    }
    const parsed = this._parseMcpBody(body)
    if (!parsed.ok) { await this.e.reply(parsed.msg); return true }
    await this.e.reply('⏳ 正在连接验证…')
    await this.e.reply((await this._applyMcpServers(parsed.servers)).join('\n'))
    return true
  }

  /** 解析 mcpServers JSON：成功 {ok:true, servers}；失败 {ok:false, msg}（不回复，由调用方决定） */
  _parseMcpBody(body) {
    let parsed
    try { parsed = JSON.parse(body) }
    catch (e) { return { ok: false, msg: `❌ JSON 解析失败：${e?.message || e}\n请粘贴完整的 mcpServers JSON。` } }
    const servers = parsed?.mcpServers || parsed
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      return { ok: false, msg: '❌ 未找到服务端配置（需 { "mcpServers": {...} } 或 { "name": {...} }）' }
    }
    return { ok: true, servers }
  }

  /** 逐个连接验证 + 注册工具；成功的写入配置持久化（触发热加载）。返回结果行数组。 */
  async _applyMcpServers(servers) {
    const rt = await getRuntime()
    const cfg = Config.get()
    cfg.agent = cfg.agent || {}
    cfg.agent.mcp = cfg.agent.mcp || {}
    cfg.agent.mcp.servers = cfg.agent.mcp.servers || {}
    const results = []
    let anyOk = false
    for (const [name, scfg] of Object.entries(servers)) {
      try {
        // add() 会连接 + 注册工具 + 验证可用（失败 entry.status='error'）
        const entry = await rt.mcp.add(name, { ...scfg, enabled: true })
        if (entry.status === 'connected') {
          cfg.agent.mcp.servers[name] = scfg
          anyOk = true
          results.push(`✅ ${name}：已连接，注册 ${entry.tools} 个工具（已写入配置）`)
        } else {
          results.push(`❌ ${name}：${entry.error || entry.status}（未写入配置）`)
        }
      } catch (e) {
        results.push(`❌ ${name}：${e?.message || e}（未写入配置）`)
      }
    }
    if (anyOk) Config.save(cfg) // 持久化成功的 + 触发热加载
    return results
  }

  /** 交互式添加：把监听期间收到的那条消息当作 mcpServers JSON 处理（处理一次即结束监听）。 */
  async _consumeMcpAddJson(raw) {
    const uid = String(this.e.user_id)
    mcpAddPending.delete(uid) // 无论成败都结束监听
    const body = (raw || '').trim()
    if (!body) { await this.e.reply('⚠️ 内容为空，已退出添加流程。重新发送 #添加mcp 可再试。'); return true }
    const parsed = this._parseMcpBody(body)
    if (!parsed.ok) { await this.e.reply(`${parsed.msg}\n（已退出添加流程，重新发送 #添加mcp 可再试）`); return true }
    await this.e.reply('⏳ 收到配置，正在连接验证…')
    await this.e.reply((await this._applyMcpServers(parsed.servers)).join('\n'))
    return true
  }


  async mcpStatus() {
    const rt = await getRuntime()
    const status = rt.mcp.status()
    const names = Object.keys(status)
    if (!names.length) return this.e.reply('未配置 MCP 服务端'), true
    const lines = names.map((n) => {
      const s = status[n]
      return `${s.status === 'connected' ? '✅' : s.status === 'error' ? '❌' : '⏳'} ${n}：${s.tools} 工具${s.error ? `（${s.error}）` : ''}`
    })
    await this.e.reply(lines.join('\n'))
    return true
  }

  // —— 配置热重载（立即重建运行时：provider/model/tools/skills/mcp）——
  async agentsReload() {
    try {
      Config.reload()
      invalidateRuntime()
      await getRuntime()
      await this.e.reply('✅ 已重载配置并重建运行时（model / tools / skills / mcp）')
    } catch (e) {
      Log.error('[reload] 重载失败', e?.message || e)
      await this.e.reply(`重载失败：${e?.message || e}`)
    }
    return true
  }

  // —— 审批 ——
  async approve() {
    const id = this.e.msg.match(/\d+/)?.[0]
    const rt = await getRuntime()
    await this.e.reply(rt.confirm.resolve(id, true) ? `已批准 #${id}` : `未找到待审 #${id}`)
    return true
  }

  async reject() {
    const id = this.e.msg.match(/\d+/)?.[0]
    const rt = await getRuntime()
    await this.e.reply(rt.confirm.resolve(id, false) ? `已拒绝 #${id}` : `未找到待审 #${id}`)
    return true
  }

  async pending() {
    const rt = await getRuntime()
    const list = rt.confirm.list()
    if (!list.length) return this.e.reply('当前无待审批'), true
    const lines = list.map((p) => `#${p.id} ${p.tool} ${JSON.stringify(p.args || {}).slice(0, 80)}`)
    await this.e.reply(lines.join('\n'))
    return true
  }

  // —— 记忆 / 提醒 ——
  async showMemory() {
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    const list = await rt.recall.listByUser(ctx.userId)
    const text = list.length ? rt.recall.formatForPrompt(list.slice(0, 20)) : rt.memory.snapshotAll()
    await this.e.reply((text || '(记忆为空)').slice(0, 4000))
    return true
  }

  async forget() {
    const kw = this.e.msg.replace(/^#忘掉\s+/, '').trim()
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    const n = await rt.recall.forget(ctx.userId, kw)
    await this.e.reply(n ? `已遗忘 ${n} 条含「${kw}」的记忆` : `未找到含「${kw}」的记忆`)
    return true
  }

  async myReminders() {
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    const list = await rt.schedule.listByUser(ctx.userId)
    if (!list.length) return this.e.reply('暂无提醒'), true
    const lines = list.map((r) => `#${r.id} ${new Date(r.at).toLocaleString()}：${r.message}`)
    await this.e.reply(lines.join('\n'))
    return true
  }

  async cancelReminder() {
    const id = this.e.msg.match(/\d+/)?.[0]
    const rt = await getRuntime()
    await rt.schedule.cancel(id)
    await this.e.reply(`已取消提醒 #${id}`)
    return true
  }

  // —— 清空自己的所有记录（不含配置文件；2 步确认）——
  async clearMyData() {
    const rt = await getRuntime()
    const uid = String(this.e.user_id)
    const now = Date.now()
    const last = _clearPending.get(uid)
    if (!last || now - last > 60000) {
      _clearPending.set(uid, now)
      await this.e.reply([
        '⚠️ 确认清空你的所有记录？将删除：',
        '· 全部对话历史',
        '· 长期记忆（recall）',
        '· 个人笔记',
        '· 提醒',
        '· 人设绑定（恢复默认）',
        '',
        '**不删除配置文件**。60 秒内再发一次「#清空所有记录」执行。',
      ].join('\n'))
      return true
    }
    _clearPending.delete(uid)
    try {
      const cleared = []
      // 会话：扫描该用户名下的所有 session 键
      const sessPrefix = 'Yz:agent:sess:'
      let nSess = 0
      for (const k of await rt.kv.scan(sessPrefix)) {
        const tail = String(k).slice(sessPrefix.length)
        const parts = tail.split(':')
        const mine = parts[0] === 'conv'
          ? (parts[1] === uid || ((parts[1] === 'active' || parts[1] === 'seq') && parts[2] === uid))
          : (parts[parts.length - 1] === uid)
        if (mine) { await rt.kv.del(k); nSess++ }
      }
      if (nSess) cleared.push(`对话历史(${nSess})`)
      // 召回记忆
      await rt.recall.clearAll(uid); cleared.push('长期记忆')
      // 个人笔记
      await rt.kv.del(`Yz:agent:note:${uid}`); cleared.push('笔记')
      // 提醒
      const rems = await rt.schedule.listByUser(uid)
      for (const r of rems) await rt.schedule.cancel(r.id)
      if (rems.length) cleared.push(`提醒(${rems.length})`)
      // 人设绑定
      await rt.persona.resetActive(uid); cleared.push('人设绑定')
      await this.e.reply('✅ 已清空你的所有记录：' + cleared.join('、') + '\n（配置文件未动；MEMORY.md/USER.md 为全局共享记忆，未清——如需可手动删除 data/agents-plugin/memories/ 下文件）')
    } catch (e) {
      Log.error('[clear] 清空失败', e?.message || e)
      await this.e.reply(`清空失败：${e?.message || e}`)
    }
    return true
  }


  // —— 人设 ——
  async personaList() {
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    const personas = rt.personaStore.list()
    const activeId = await rt.persona.getActiveId(ctx.userId)
    const html = buildPersonaListHtml({ user: ctx.userId, personas, activeId })
    const img = await screenshot('agents-plugin/persona-list', html)
    if (img) return this.e.reply(img), true
    const lines = personas.map((p) => `${p.id === activeId ? '★' : '·'} #${p.id} ${p.name}${p.builtin ? '（内置）' : ''} — ${p.description}`)
    await this.e.reply(['人设列表（#人设 + id 切换）', ...lines].join('\n'))
    return true
  }

  async personaSwitch() {
    const idOrName = this.e.msg.replace(/^#人设\s+/, '').trim()
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    try {
      const p = await rt.persona.setActive(ctx.userId, idOrName)
      await this.e.reply(`已切换人设：${p.name}${p.greeting ? `\n${p.greeting}` : ''}`)
    } catch (e) {
      await this.e.reply(e?.message || '切换失败，发送 #人设 查看列表')
    }
    return true
  }

  async personaDetail() {
    const idOrName = this.e.msg.replace(/^#人设详情\s+/, '').trim()
    const rt = await getRuntime()
    const p = rt.personaStore.get(idOrName)
    if (!p) return this.e.reply(`未找到人设「${idOrName}」`), true
    const tags = p.tags?.length ? ` | 标签：${p.tags.join('、')}` : ''
    await this.e.reply([
      `#${p.id} ${p.name}${p.builtin ? '（内置）' : '（自定义）'}${tags}`,
      p.description,
      '—— 人设内容 ——',
      p.systemPrompt,
    ].join('\n'))
    return true
  }

  async personaCreate() {
    const rest = this.e.msg.replace(/^#新建人设\s+/, '').trim()
    const sp = rest.indexOf(' ')
    if (sp < 0) return this.e.reply('格式：#新建人设 <名称> <人设内容>（名称与内容用空格分隔）'), true
    const name = rest.slice(0, sp).trim()
    const systemPrompt = rest.slice(sp + 1).trim()
    if (!name || systemPrompt.length < 2) return this.e.reply('名称或人设内容过短'), true
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    try {
      const p = rt.personaStore.add({ name, systemPrompt }, { creator: ctx.userId })
      await rt.persona.setActive(ctx.userId, p.id)
      await this.e.reply(`已创建并切换到人设：${p.name}（#${p.id}）`)
    } catch (e) {
      await this.e.reply(e?.message || '创建失败')
    }
    return true
  }

  async personaDelete() {
    const idOrName = this.e.msg.replace(/^#删除人设\s+/, '').trim()
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    const p = rt.personaStore.get(idOrName)
    if (!p) return this.e.reply(`未找到人设「${idOrName}」`), true
    if (p.builtin) return this.e.reply(`内置人设「${p.name}」不可删除`), true
    // 仅创建者或 master 可删
    if (p.creator && p.creator !== ctx.userId && !ctx.isMaster) {
      return this.e.reply('仅人设创建者或主人可删除'), true
    }
    rt.personaStore.remove(p.id)
    await rt.persona.resetActive(ctx.userId)
    await this.e.reply(`已删除人设：${p.name}（#${p.id}）`)
    return true
  }

  async personaReset() {
    const rt = await getRuntime()
    const ctx = ctxOf(this.e)
    await rt.persona.resetActive(ctx.userId)
    await this.e.reply('已恢复默认人设')
    return true
  }
}
