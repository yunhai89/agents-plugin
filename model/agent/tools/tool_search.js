/**
 * tool_search —— 工具按需发现的元工具（Tool Discovery / Tool RAG）。
 *
 * 与全量下发 tools schema 相对：LLM 只常驻少数核心工具，遇到非常驻能力时调用本工具，
 * 用自然语言描述"要做什么" → registry.search 检索匹配工具 → 命中工具名加入 Agent 激活集
 * （per-run 累积）→ 下一轮这些工具的完整 schema 进入 tools 数组，LLM 直接调用。
 *
 * 设计要点：
 *  - per-instance 元工具：makeToolSearchTool(registry, agent, cfg) 闭包绑 Agent 实例
 *    （工具 execute 拿到的 ctx 是 Yunzai ctx、无 .agent，故不能靠 execCtx.agent）。
 *  - 本工具 category:'query'（人人可搜，检索本身只读）；被激活的工具调用时仍走各自 RBAC/confirm（安全不变）。
 *  - 自身不入 registry 索引（registry._ensureIndex 跳过 tool_search）。
 *
 * 参考 makeSkillTool 范式（skill/index.js），但返回结构化"工具速查 + 激活名"而非指令文本。
 */

const CATEGORY_ORDER = ['query', 'personal', 'message', 'group_manage', 'system']
const CATEGORY_LABELS = { query: '查询', personal: '个人', message: '消息', group_manage: '群管', system: '系统' }

/**
 * @param {object} registry ToolRegistry（检索源）
 * @param {object} agent Agent 实例（activeTools/devLog 挂其上，闭包捕获）
 * @param {object} cfg { topK?, minScore? }
 */
export function makeToolSearchTool(registry, agent, cfg = {}) {
  return {
    name: 'tool_search',
    description: [
      '搜索并激活当前未常驻的工具。当已有常驻工具不足以完成用户任务时调用：',
      '用一句自然语言描述"你要做什么/需要什么能力"，返回最匹配的工具（按类别分组，含一句话说明与必填参数），',
      '并自动激活它们——激活后下一轮即可像常驻工具一样直接调用。同类需求换关键词可重搜。',
      '未命中时可传 category 浏览某类下全部工具。',
    ].join(''),
    category: 'query',
    meta: { summary: '搜索并激活工具' },
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '自然语言描述你要做什么/需要什么能力（如"踢出一个群成员""读取PDF""发群公告"）' },
        category: { type: 'string', enum: CATEGORY_ORDER, description: '可选：限定在某类别下浏览（query/personal/message/group_manage/system）' },
        topK: { type: 'integer', description: '返回数量（默认按配置；未命中可调大）' },
      },
      required: ['query'],
    },
    async execute({ query, category, topK } = {}, ctx) {
      const q = String(query || '').trim()
      if (!q) return { error: '缺少 query 参数' }
      const k = Math.max(1, Math.min(20, Number(topK) || cfg.topK || 8))
      const hits = await registry.search(q, { topK: k, category: category || undefined, minScore: cfg.minScore ?? 0.3 })

      const active = agent.activeTools || new Set()
      const fresh = []
      const already = []
      for (const h of hits) {
        if (h.name === 'tool_search') continue
        if (active.has(h.name)) already.push(h)
        else {
          active.add(h.name) // ★ 激活：加入 per-run 激活集，下一轮进入 tools 数组
          fresh.push(h)
        }
      }

      const text = formatDiscoveryText(fresh, already)

      agent.devLog?.('tool_discovery', {
        query: q,
        category: category || null,
        hits: hits.map((h) => ({ name: h.name, score: Number(h.score.toFixed(3)), category: h.category })),
        activated: fresh.map((h) => h.name),
        alreadyActive: already.map((h) => h.name),
        activeTotal: active.size,
      }, agent._curTaskId, ctx?.devScope || agent._curDevScope)

      if (!fresh.length && !already.length) {
        return {
          found: 0,
          activated: [],
          text: `未找到匹配「${q}」的工具。可：① 换个说法重搜；② 传 category 浏览类别（${CATEGORY_ORDER.join('/')}）；③ 该能力可能需开启某功能（如 terminal/pixiv）或安装 MCP 服务端。`,
        }
      }
      return {
        found: fresh.length,
        activated: fresh.map((h) => h.name),
        alreadyActive: already.map((h) => h.name),
        text,
      }
    },
  }
}

function formatDiscoveryText(fresh, already) {
  const lines = []
  if (fresh.length) {
    lines.push(fresh.length === 1 ? '已为你激活以下工具，可直接调用：' : `已为你激活以下 ${fresh.length} 个工具，可直接调用：`)
    const grouped = {}
    for (const h of fresh) (grouped[h.category] ||= []).push(h)
    for (const cat of CATEGORY_ORDER) {
      const arr = grouped[cat]
      if (!arr?.length) continue
      lines.push(`[${CATEGORY_LABELS[cat] || cat}类]`)
      for (const h of arr) {
        const req = h.required?.length ? `（需 ${h.required.join(',')}）` : ''
        const confirm = (cat === 'group_manage' || cat === 'system') ? ' ⚠️调用需审批' : ''
        const summary = h.summary ? `：${h.summary.length > 40 ? h.summary.slice(0, 40) + '…' : h.summary}` : ''
        lines.push(`- ${h.name}${summary}${req}${confirm}`)
      }
    }
  }
  if (already.length) lines.push(`（另有 ${already.length} 个已常驻/已激活：${already.map((h) => h.name).join(',')}）`)
  lines.push('如不够，换关键词或调大 topK 重搜；也可传 category 浏览某类全部工具。')
  return lines.join('\n')
}
