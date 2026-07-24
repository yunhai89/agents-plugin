import plugin from '../../../lib/plugins/plugin.js'
import { getStickerManager } from '../model/sticker/manager.js'

let busy = false // 安装/更新互斥（长任务）

/**
 * 表情包资源管理指令（仅主人）。
 *   #表情包安装              浅克隆仓库（NSFW 目录默认排除）→ 同步 → 自动开启
 *   #表情包更新              拉取上游 → 同步；HEAD 未变则提示已是最新
 *   #表情包状态              总数/体积/上游 commit/高频 Top5
 *   #表情包开启 / #表情包关闭   热开关
 *   #表情包目录              列出源目录及启停状态
 *   #表情包目录 启用/停用 <目录>  子集管理（停用即重建清单并清出 images）
 */
export class StickerCmd extends plugin {
  constructor() {
    super({
      name: 'agents_表情包',
      dsc: '表情包资源管理（下载/更新/开关）',
      event: 'message',
      priority: 1000,
      rule: [
        { reg: '^#表情包(资源)?安装$', fnc: 'install' },
        { reg: '^#表情包(资源)?更新$', fnc: 'update' },
        { reg: '^#表情包(资源)?状态$', fnc: 'status' },
        { reg: '^#表情包开启$', fnc: 'enable' },
        { reg: '^#表情包关闭$', fnc: 'disable' },
        { reg: '^#表情包目录\\s+(启用|停用)\\s*(\\S+)$', fnc: 'dirToggle' },
        { reg: '^#表情包目录$', fnc: 'dirList' },
      ],
    })
  }

  async install() {
    if (!this.e.isMaster) { await this.reply('仅主人可用此指令'); return false }
    if (busy) { await this.reply('正在处理中，请稍候'); return false }
    const m = getStickerManager()
    busy = true
    try {
      // 全程静默：测速/排名/下载进度/切换仅打控制台（manager.logger），群聊只在结束回成功/失败
      const r = await m.install()
      if (r.ok) {
        m.setEnable(true) // 安装成功自动开启
        await this.reply(`✅ ${r.msg} 已自动开启表情包功能。`)
      } else {
        await this.reply(`❌ ${r.msg}`)
      }
    } finally {
      busy = false
    }
    return true
  }

  async update() {
    if (!this.e.isMaster) return false
    if (busy) { await this.reply('正在处理中，请稍候'); return false }
    busy = true
    try {
      // 全程静默，仅控制台打进度
      const r = await getStickerManager().update()
      await this.reply(r.ok ? (r.noop ? r.msg : `✅ ${r.msg}`) : `❌ ${r.msg}`)
    } finally {
      busy = false
    }
    return true
  }

  async status() {
    if (!this.e.isMaster) return false
    await this.reply(getStickerManager().status())
    return true
  }

  async enable() {
    if (!this.e.isMaster) return false
    const m = getStickerManager()
    m.setEnable(true)
    await this.reply(m.enabled() ? '✅ 表情包已开启' : '✅ 表情包已开启（但尚未下载资源，请先 #表情包安装）')
    return true
  }

  async disable() {
    if (!this.e.isMaster) return false
    getStickerManager().setEnable(false)
    await this.reply('✅ 表情包已关闭（模型不再附带表情包）')
    return true
  }

  async dirList() {
    if (!this.e.isMaster) return false
    await this.reply(getStickerManager().dirList())
    return true
  }

  async dirToggle() {
    if (!this.e.isMaster) return false
    const enable = /启用/.test(this.e.msg)
    const dir = (this.e.msg.match(/(?:启用|停用)\s*(\S+)/) || [])[1]
    const r = await getStickerManager().dirToggle(dir, enable)
    await this.reply(r.ok ? `✅ ${r.msg}` : `❌ ${r.msg}`)
    return true
  }
}
