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
    title: '主人指令',
    commands: [
      { cmd: '#模型切换 +id', desc: '切换 LLM 模型' },
      { cmd: '#添加mcp +JSON', desc: '按标准 mcpServers JSON 添加 MCP（连接验证+持久化）' },
      { cmd: '#启用mcp +名', desc: '启用某个 MCP 服务端' },
      { cmd: '#停止mcp +名', desc: '停止某个 MCP 服务端' },
      { cmd: '#mcp', desc: '查看 MCP 连接状态' },
      { cmd: '#agents更新', desc: '更新插件（有改动自动重启）' },
      { cmd: '#agents重载', desc: '热重载配置（免重启）' },
      { cmd: '#确认 / #拒绝 +id', desc: '审批待执行的危险动作' },
      { cmd: '#待确认', desc: '列出待审批' },
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
