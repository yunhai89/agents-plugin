/**
 * 图片渲染的 HTML 构建器（纯函数，离线可测）。
 * 浅色调、清晰排版；实际截图在 apps/render.js 经 Yunzai puppeteer 完成。
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  background: linear-gradient(135deg,#eef2ff 0%,#f6f8fc 50%,#e7f0ff 100%); padding:24px; color:#1f2937; }
.card { width:540px; background:#ffffff; border-radius:16px; overflow:hidden;
  box-shadow: 0 10px 34px rgba(31,41,55,.10); }
.header { background: linear-gradient(135deg,#6366f1,#3b82f6); color:#fff; padding:20px 24px; font-size:20px; font-weight:600; letter-spacing:.4px; }
.sub { color:#dbeafe; font-size:12px; font-weight:400; margin-top:4px; }
.section { padding:14px 24px; border-bottom:1px solid #f0f2f5; }
.section-title { font-size:12px; color:#6b7280; font-weight:600; margin-bottom:8px; letter-spacing:.5px; }
.cmd { display:flex; align-items:baseline; padding:5px 0; }
.cmd-key { flex:0 0 168px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size:12.5px; color:#2563eb;
  background:#eff6ff; padding:2px 8px; border-radius:6px; margin-right:12px; white-space:nowrap; }
.cmd-desc { font-size:13px; color:#4b5563; line-height:1.5; }
.footer { padding:13px 24px; font-size:11.5px; color:#9ca3af; text-align:center; background:#fafbfc; }
.conv { display:flex; align-items:center; padding:13px 24px; border-bottom:1px solid #f3f4f6; }
.conv.active { background:#eff6ff; }
.conv-id { flex:0 0 auto; width:46px; font-weight:700; color:#3b82f6; font-size:15px; }
.conv-body { flex:1; min-width:0; padding-right:10px; }
.conv-title { font-size:14px; font-weight:600; color:#1f2937; margin-bottom:3px; display:flex; align-items:center; gap:7px; }
.conv-preview { font-size:12px; color:#9ca3af; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.badge { font-size:11px; background:#3b82f6; color:#fff; padding:1px 8px; border-radius:10px; font-weight:500; }
.conv-meta { flex:0 0 auto; font-size:11px; color:#9ca3af; text-align:right; line-height:1.6; }
.empty { padding:42px 24px; text-align:center; color:#9ca3af; font-size:14px; }
.persona { display:flex; align-items:flex-start; gap:12px; padding:14px 24px; border-bottom:1px solid #f3f4f6; }
.persona.active { background:#eff6ff; }
.persona-ava { flex:0 0 40px; width:40px; height:40px; border-radius:50%; background:linear-gradient(135deg,#a5b4fc,#60a5fa); color:#fff; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:600; }
.persona-body { flex:1; min-width:0; }
.persona-name { font-size:14px; font-weight:600; color:#1f2937; display:flex; align-items:center; gap:7px; margin-bottom:3px; }
.persona-desc { font-size:12px; color:#6b7280; line-height:1.5; }
.tag { font-size:10.5px; color:#6366f1; background:#eef2ff; padding:1px 7px; border-radius:8px; margin-right:4px; }
.persona-id { flex:0 0 auto; font-family: ui-monospace,Menlo,Consolas,monospace; font-size:11px; color:#9ca3af; }
`

function doc(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="card">${inner}</div></body></html>`
}

/**
 * 帮助图：sections = [{ title, commands:[{cmd, desc}] }]
 */
export function buildHelpHtml({ title = 'agents-plugin 帮助', subtitle = '', sections = [] } = {}) {
  const body = `
    <div class="header">${esc(title)}${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div>
    ${sections.map((s) => `
      <div class="section">
        <div class="section-title">${esc(s.title)}</div>
        ${s.commands.map((c) => `
          <div class="cmd">
            <span class="cmd-key">${esc(c.cmd)}</span>
            <span class="cmd-desc">${esc(c.desc)}</span>
          </div>`).join('')}
      </div>`).join('')}
    <div class="footer">agents-plugin · AI Agent 驱动 · 主人指令以 # 标注</div>`
  return doc(body)
}

/**
 * 聊天列表图：conversations = [{ id, title, count, updatedAt, preview }]
 */
export function buildChatListHtml({ user = '', conversations = [], activeId = null } = {}) {
  const items = conversations.length
    ? conversations.map((c) => `
        <div class="conv ${c.id === activeId ? 'active' : ''}">
          <div class="conv-id">#${esc(c.id)}</div>
          <div class="conv-body">
            <div class="conv-title">${esc(c.title)}${c.id === activeId ? '<span class="badge">当前</span>' : ''}</div>
            <div class="conv-preview">${esc(c.preview || '（暂无消息）')}</div>
          </div>
          <div class="conv-meta">${esc(c.count)} 条<br>${esc(fmtTime(c.updatedAt))}</div>
        </div>`).join('')
    : '<div class="empty">还没有对话，@机器人 或 #new 开始第一段对话</div>'
  const body = `
    <div class="header">聊天列表${user ? `<div class="sub">用户 ${esc(user)}</div>` : ''}</div>
    ${items}
    <div class="footer">#进入聊天 + id 切换 · #new 新建对话</div>`
  return doc(body)
}

/**
 * 人设列表图：personas = [{ id, name, description, tags, builtin }]
 */
export function buildPersonaListHtml({ user = '', personas = [], activeId = null } = {}) {
  const items = personas.length
    ? personas.map((p) => `
        <div class="persona ${p.id === activeId ? 'active' : ''}">
          <div class="persona-ava">${esc((p.name || '?').slice(0, 1))}</div>
          <div class="persona-body">
            <div class="persona-name">${esc(p.name)}${p.id === activeId ? '<span class="badge">当前</span>' : ''}${p.builtin ? '<span class="tag">内置</span>' : '<span class="tag">自定义</span>'}</div>
            <div class="persona-desc">${esc(p.description || '')}</div>
          </div>
          <div class="persona-id">#${esc(p.id)}</div>
        </div>`).join('')
    : '<div class="empty">还没有人设</div>'
  const body = `
    <div class="header">人设列表${user ? `<div class="sub">用户 ${esc(user)}</div>` : ''}</div>
    ${items}
    <div class="footer">#人设 + id 切换 · #新建人设 创建 · #重置人设 恢复默认</div>`
  return doc(body)
}
