/**
 * Pixiv 工具集（内置）—— 基于 @ibaraki-douji/pixivts。
 *
 * 工具：
 *  - pixiv_search   按关键词/标签搜插画（返回列表，模型据此挑作品）
 *  - pixiv_illust   按 id 取作品详情，并【自动发送图片到聊天】（经代理，QQ 可显示）
 *  - pixiv_ranking  取排行榜（日/周/月/男性/女性/AI 等）
 *  - pixiv_user     取用户资料 + 近期作品
 *  - pixiv_tags     标签自动补全（帮模型找到正确的标签拼写）
 *
 * 全部 query 类别（只读）；pixiv_illust 像 create_excel 一样有"发图"副作用。
 * 鉴权/初始化失败时返回 {error}（已配 refreshToken + enable 才注册）。
 */

import { defineTool, param } from '../toolkit/index.js'
import Config from '../../utils/Config.js'
import Log from '../../utils/Log.js'
import { getPixiv, proxyImage } from './client.js'

const cfg = () => Config.get().agent?.pixiv || {}
const RANK_MODES = ['day', 'week', 'month', 'day_male', 'day_female', 'day_ai', 'week_original', 'week_rookie']

/** 作品一行简介：标记(R-18/AI)+id+标题+作者+收藏/浏览+P数+标签 */
function brief(illust) {
  const tags = (illust.tags || []).slice(0, 5).map((t) => t.name).join('、')
  const r18 = illust.x_restrict === 2 ? '[R-18G] ' : illust.x_restrict === 1 ? '[R-18] ' : ''
  const ai = illust.illust_ai_type === 2 ? '[AI] ' : ''
  return `${r18}${ai}#${illust.id} 《${illust.title}》by ${illust.user?.name || '?'} | ❤${illust.total_bookmarks ?? 0} 👁${illust.total_view ?? 0} | ${illust.page_count ?? 1}P${tags ? ` | ${tags}` : ''}`
}

/** 取作品图片地址（large 优先，平衡清晰度与体积）→ 经代理，限量 */
function imageUrlsOf(illust, max) {
  const out = []
  const push = (u) => { if (u && out.length < max) out.push(proxyImage(u)) }
  if ((illust.page_count || 1) > 1 && illust.meta_pages?.length) {
    for (const p of illust.meta_pages) push(p.image_urls?.large || p.image_urls?.medium || p.image_urls?.original)
  } else {
    push(illust.meta_single_page?.original_image_url || illust.image_urls?.large || illust.image_urls?.medium)
  }
  return out
}

/** pixiv_search：按关键词/标签搜插画 */
export const pixivSearchTool = defineTool({
  name: 'pixiv_search',
  description: '在 Pixiv 搜索插画（关键词或标签）。返回作品列表(id/标题/作者/收藏/标签)。用户要找图/画师/某题材时用。拿到 id 后用 pixiv_illust 取图并发送。',
  category: 'query',
  meta: { summary: '搜索 Pixiv 插画', resultCap: 8000 },
  parameters: param.object({
    word: param.str('搜索关键词或标签（中文/日文/英文均可，标签用 tagAutocomplete 确认拼写更准）'),
    page: param.int('页码（默认 1，每页 30）'),
    withAi: param.bool('是否包含 AI 作品（默认 false 只看人工）'),
  }, ['word']),
  async execute(p) {
    const c = await getPixiv()
    if (!c.ok) return { error: c.error }
    let list
    try {
      list = await c.illusts.searchIllusts(String(p.word), Math.max(1, Number(p.page) || 1), { withAi: p.withAi === true })
    } catch (e) { return { error: `搜索失败：${e?.message || e}` } }
    const items = (list || []).map(brief)
    return { ok: true, word: p.word, count: items.length, results: items, hint: items.length ? '挑一个 id 用 pixiv_illust 取图' : '无结果，换个词或用 pixiv_tags 查标签拼写' }
  },
})

/** pixiv_illust：按 id 取作品详情 + 自动发图到聊天 */
export const pixivIllustTool = defineTool({
  name: 'pixiv_illust',
  description: '按作品 id 获取 Pixiv 插画详情（标题/作者/标签/简介/收藏），并【自动发送图片到聊天】（经代理，QQ 可直接显示）。id 从 pixiv_search / pixiv_ranking / pixiv 链接获取。',
  category: 'query',
  meta: { summary: '取 Pixiv 作品并发图', interactive: true },
  parameters: param.object({
    id: param.str('作品 id（数字，或 pixiv 作品链接里的 artworks/ 后那段）'),
    sendImages: param.bool('是否发送图片到聊天（默认 true）'),
  }, ['id']),
  async execute(p, ctx) {
    const c = await getPixiv()
    if (!c.ok) return { error: c.error }
    const id = Number(String(p.id).trim().replace(/^.*artworks\/?/i, ''))
    if (!id) return { error: `无效的作品 id：${p.id}` }
    let illust
    try { illust = await c.illusts.getIllustById(id) }
    catch (e) { return { error: `获取作品失败：${e?.message || e}（id=${id}，可能已删除或 R-18 限制）` } }

    const maxImages = Math.min(10, Math.max(1, Number(cfg().maxImages) || 4))
    const wantImages = p.sendImages !== false
    const urls = wantImages ? imageUrlsOf(illust, maxImages) : []

    let sent = 0
    if (urls.length && ctx?.e?.reply && typeof segment !== 'undefined') {
      for (const u of urls) {
        try { await ctx.e.reply(segment.image(u)); sent++ }
        catch (e) { Log.warn('[pixiv] 发图失败', e?.message || e, u) }
      }
    }
    const tags = (illust.tags || []).map((t) => ({ name: t.name, translated: t.translated_name || null }))
    return {
      ok: true,
      id: illust.id,
      title: illust.title,
      author: illust.user?.name,
      authorId: illust.user?.id,
      pageCount: illust.page_count,
      bookmarks: illust.total_bookmarks,
      views: illust.total_view,
      width: illust.width,
      height: illust.height,
      aiType: illust.illust_ai_type,
      xRestrict: illust.x_restrict,
      caption: String(illust.caption || '').replace(/<[^>]+>/g, '').trim().slice(0, 300),
      tags,
      imageUrls: urls,
      sentImages: sent,
      note: sent ? `已发送 ${sent} 张图到聊天` : (wantImages ? '图片未发送（无 segment 或会话不支持）' : '未请求发图'),
    }
  },
})

/** pixiv_ranking：取排行榜 */
export const pixivRankingTool = defineTool({
  name: 'pixiv_ranking',
  description: '获取 Pixiv 插画排行榜（mode=day/week/month/day_male/day_female/day_ai/week_original/week_rookie，默认 day 日榜）。返回前若干名列表，挑 id 用 pixiv_illust 取图。',
  category: 'query',
  meta: { summary: 'Pixiv 排行榜', resultCap: 8000 },
  parameters: param.object({
    mode: param.enum(`榜单类型：${RANK_MODES.join('/')}`, RANK_MODES),
    page: param.int('页码（默认 1）'),
  }),
  async execute(p) {
    const c = await getPixiv()
    if (!c.ok) return { error: c.error }
    const mode = RANK_MODES.includes(p.mode) ? p.mode : 'day'
    let list
    try { list = await c.illusts.getRankingIllusts(mode, Math.max(1, Number(p.page) || 1)) }
    catch (e) { return { error: `获取榜单失败：${e?.message || e}` } }
    const items = (list || []).map(brief)
    return { ok: true, mode, count: items.length, results: items }
  },
})

/** pixiv_user：用户资料 + 近期作品 */
export const pixivUserTool = defineTool({
  name: 'pixiv_user',
  description: '获取 Pixiv 用户资料（昵称/简介/关注/作品数）+ 近期插画列表。userId 为数字 Pixiv uid。',
  category: 'query',
  meta: { summary: 'Pixiv 用户资料', resultCap: 8000 },
  parameters: param.object({
    userId: param.str('Pixiv 用户 uid（数字）'),
  }, ['userId']),
  async execute(p) {
    const c = await getPixiv()
    if (!c.ok) return { error: c.error }
    const uid = Number(String(p.userId).trim())
    if (!uid) return { error: `无效的 uid：${p.userId}` }
    let profile, works
    try {
      profile = await c.users.getUser(uid)
      works = await c.users.getUserIllusts(uid).catch(() => [])
    } catch (e) { return { error: `获取用户失败：${e?.message || e}` } }
    const u = profile?.user || {}
    const vp = profile?.profile || {}
    const items = (Array.isArray(works) ? works : (works?.illusts || [])).slice(0, 10).map(brief)
    return {
      ok: true,
      user: { id: u.id, name: u.name, account: u.account, comment: String(u.comment || '').slice(0, 200) },
      avatar: proxyImage(u.profile_image_urls?.medium),
      stats: { illusts: vp.total_illusts, manga: vp.total_manga, followers: vp.total_mypixiv_users, following: vp.total_follow_users },
      recentWorks: items,
    }
  },
})

/** pixiv_tags：标签自动补全 */
export const pixivTagsTool = defineTool({
  name: 'pixiv_tags',
  description: 'Pixiv 标签自动补全：输入词返回匹配的官方标签(含中文/英文译名)。搜索前用它能拿到准确的标签拼写，命中率更高。',
  category: 'query',
  meta: { summary: 'Pixiv 标签补全' },
  parameters: param.object({
    word: param.str('要补全的词（片段即可）'),
  }, ['word']),
  async execute(p) {
    const c = await getPixiv()
    if (!c.ok) return { error: c.error }
    let tags
    try { tags = await c.tags.tagAutocomplete(String(p.word)) }
    catch (e) { return { error: `标签补全失败：${e?.message || e}` } }
    const items = (tags || []).map((t) => ({ name: t.name, translated: t.translated_name || null }))
    return { ok: true, word: p.word, count: items.length, tags: items }
  },
})

export const pixivTools = [pixivSearchTool, pixivIllustTool, pixivRankingTool, pixivUserTool, pixivTagsTool]
