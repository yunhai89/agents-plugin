import plugin from '../../../lib/plugins/plugin.js'
import Config from '../utils/Config.js'
import { buildHelpHtml } from '../model/agent/index.js'
import { screenshot } from './render.js'

const SECTIONS = [
  {
    title: '触发对话',
    commands: [
      { cmd: '@机器人 +内容', desc: '艾特机器人对话（默认触发）' },
      { cmd: '#ai +内容', desc: '自定义触发词（需 agent.trigger=command/both）' },
    ],
  },
  {
    title: '对话管理',
    commands: [
      { cmd: '#聊天列表', desc: '查看你的所有对话（图片）' },
      { cmd: '#进入聊天 +id', desc: '切换到指定对话继续聊天' },
      { cmd: '#new', desc: '新建一段对话' },
    ],
  },
  {
    title: '记忆 / 提醒',
    commands: [
      { cmd: '#记忆', desc: '查看长期记忆' },
      { cmd: '#忘掉 +关键词', desc: '按关键词遗忘记忆' },
      { cmd: '#我的提醒', desc: '查看我的提醒' },
      { cmd: '#取消提醒 +id', desc: '取消指定提醒' },
      { cmd: '#清空所有记录', desc: '清空自己的对话/记忆/提醒等（不含配置，2步确认）' },
    ],
  },
  {
    title: '人设',
    commands: [
      { cmd: '#人设', desc: '查看人设列表（图片）' },
      { cmd: '#人设 +id', desc: '切换到指定人设' },
      { cmd: '#人设详情 +id', desc: '查看人设内容' },
      { cmd: '#新建人设 +名称 +内容', desc: '创建自定义人设并切换' },
      { cmd: '#删除人设 +id', desc: '删除自定义人设' },
      { cmd: '#重置人设', desc: '恢复默认人设' },
    ],
  },
  {
    title: '深度研究',
    commands: [
      { cmd: '#研究 +主题', desc: '深度研究（结果优先 PDF→高清图→文本）' },
    ],
  },
  {
    title: '表情包',
    commands: [
      { cmd: '#表情包安装', desc: '克隆表情包仓库（自动测速选最快 GitHub 代理）' },
      { cmd: '#表情包更新', desc: '拉取上游更新（HEAD 未变则跳过）' },
      { cmd: '#表情包状态', desc: '总数/体积/上游 commit/高频 Top5' },
      { cmd: '#表情包开启 / #表情包关闭', desc: '热开关（即改即生效）' },
      { cmd: '#表情包目录', desc: '查看源目录；#表情包目录 启用/停用 <名> 管理子集' },
    ],
  },
  {
    title: '主人指令',
    commands: [
      { cmd: '#模型切换 +id', desc: '切换 LLM 模型' },
      { cmd: '#添加mcp +JSON', desc: '添加 MCP；私聊可不带 JSON，进入交互式添加（粘 JSON 即用）' },
      { cmd: '#启用mcp +名', desc: '启用某个 MCP 服务端' },
      { cmd: '#停止mcp +名', desc: '停止某个 MCP 服务端' },
      { cmd: '#mcp', desc: '查看 MCP 连接状态' },
      { cmd: '#agents更新', desc: '更新插件（有改动自动重启）' },
      { cmd: '#agents版本', desc: '查看当前插件版本号' },
      { cmd: '#agents更新日志', desc: '查看近期版本更新日志' },
      { cmd: '#agents重载', desc: '热重载配置（免重启）' },
      { cmd: '#agents状态', desc: '查看插件运行状态（触发模式/模型/调试日志）' },
      { cmd: '#确认 / #拒绝 +id', desc: '审批待执行的危险动作' },
      { cmd: '#待确认', desc: '列出待审批' },
      { cmd: '#上报错误 +描述', desc: '上报问题给 master（所有人可发，附最近会话日志）' },
    ],
  },
  {
    title: '在线自进化（主人）',
    commands: [
      { cmd: '#审阅进化', desc: '查看后台自评审产出的待审 suggestion（prompt/技能类）' },
      { cmd: '#采纳 +id', desc: '采纳一条 suggestion（prompt 类下轮生效）' },
      { cmd: '#拒绝进化 +id', desc: '拒绝并删除一条 suggestion' },
      { cmd: '#回滚 +key', desc: '回滚 prompt 到内置默认（如 #回滚 agent）' },
      { cmd: '#进化 prompt +key', desc: '离线 GEPA 进化 prompt（采样轨迹→迭代→judge，约 1-3 分钟）' },
      { cmd: '#进化工具 +能力描述', desc: '生成候选工具（LLM 生成 + typescript AST 验证 → draft，待审批上线）' },
    ],
  },
]

export class Help extends plugin {
  constructor() {
    super({
      name: 'agents帮助',
      dsc: '查看 agents-plugin 帮助（图片）',
      event: 'message',
      priority: 500,
      rule: [
        { reg: '^#agents帮助$', fnc: 'help' },
        { reg: '^#agents状态$', fnc: 'status', permission: 'master' },
      ],
    })
  }

  async help() {
    const html = buildHelpHtml({ title: 'agents-plugin 帮助', subtitle: 'AI Agent · 工具 · 记忆 · MCP', sections: SECTIONS })
    const img = await screenshot('agents-plugin/help', html)
    if (img) return this.e.reply(img), true
    // 文本回退（puppeteer 不可用时）
    const lines = ['#agents帮助']
    for (const s of SECTIONS) {
      lines.push(`【${s.title}】`)
      for (const c of s.commands) lines.push(`${c.cmd}  ${c.desc}`)
    }
    await this.e.reply(lines.join('\n'))
    return true
  }

  async status() {
    const a = (Config.get() || {}).agent || {}
    const debug = (Config.get() || {}).debug
    await this.e.reply([
      'agents-plugin 状态',
      `触发模式：${a.trigger || 'at'}（${a.triggerCommand || '#ai'}）`,
      `当前模型：${a.model || '未配置'}`,
      `调试日志：${debug ? '开' : '关'}`,
    ].join('\n'))
    return true
  }
}
