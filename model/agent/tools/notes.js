/**
 * notes 工具 —— 每用户个人笔记（category 'personal'，自我范围、免审批）。
 * 对应 yunhai lib/agent/tools/personal.js 的 get_note/set_note。
 */

export function noteTools({ kv, prefix = 'Yz:agent:note:', maxChars = 4000 } = {}) {
  if (!kv) throw new Error('noteTools 需要 kv')
  return [
    {
      name: 'get_note',
      description: '读取当前用户的个人笔记（此前让用户保存的备忘/偏好/待办）。何时用：用户让你"记一下/别忘了"或提到之前交代过的事项时，先读取核对。',
      category: 'personal',
      meta: { summary: '读取个人笔记' },
      parameters: { type: 'object', properties: {} },
      async execute(_p, ctx) {
        const v = await kv.get(prefix + ctx?.userId)
        return v || '(暂无笔记)'
      },
    },
    {
      name: 'set_note',
      description: '保存/覆盖当前用户的个人笔记（上限 4000 字符）。何时用：用户明确让你记住某些事项（备忘/偏好/待办）时调用。会覆盖旧笔记——若需追加，先 get_note 再合并后 set。',
      category: 'personal',
      meta: { summary: '保存个人笔记（覆盖）' },
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      async execute(p, ctx) {
        const text = String(p.text || '').slice(0, maxChars)
        await kv.set(prefix + ctx?.userId, text)
        return { ok: true, length: text.length }
      },
    },
  ]
}
