/**
 * 米游社 Agent 工具 + 结果格式化（给 AI 看，AI 再转述给用户）。
 * 移植自 miyoushe.service.ts 的 format* 函数。
 *
 * 工具：
 *  - miyoushe_search  关键词搜索帖子
 *  - miyoushe_post    按 postId 取帖子详情
 *  - miyoushe_replies 按 postId 取热评
 *
 * 配置经 ctx 传入：ctx.miyoushe = { cookie, defaultGid }，ctx.fetcher 可注入。
 */

import { searchPosts, getPostDetail, getPostReplies, getGameGid } from './client.js'

function fmtDate(ts) {
  return ts ? new Date(ts * 1000).toLocaleString('zh-CN') : ''
}
function fmtDateShort(ts) {
  return ts ? new Date(ts * 1000).toLocaleDateString('zh-CN') : ''
}

export function formatSearchResults(data) {
  if (!data.posts.length) return `米游社搜索「${data.keyword}」没有找到相关帖子。`
  let text = `**米游社搜索结果**（关键词: ${data.keyword}）：\n\n`
  for (const p of data.posts) {
    const tags = p.topics.length ? ` ${p.topics.map((t) => `#${t}`).join(' ')}` : ''
    const badges = [p.flags.isTop ? '置顶' : '', p.flags.isGood ? '精华' : '', p.flags.isOfficial ? '官方' : '']
      .filter(Boolean).join(' ')
    text += `- **${p.title}**${badges ? ` [${badges}]` : ''}${tags}\n`
    text += `  作者: ${p.author.nickname} (Lv.${p.author.level}) | ❤️${p.stats.like} 💬${p.stats.reply} ⭐${p.stats.collect} 👁️${p.stats.view} | ${fmtDateShort(p.createdAt)}\n`
    if (p.summary) text += `  ${p.summary.slice(0, 150)}\n`
    text += `  帖子ID: ${p.postId} | 链接: ${p.link}\n\n`
  }
  text += `查看帖子详情请提供帖子ID。`
  return text
}

export function formatPostDetail(post) {
  const badges = [post.flags.isTop ? '置顶' : '', post.flags.isGood ? '精华' : '', post.flags.isOfficial ? '官方' : '', post.flags.isOriginal ? '原创' : ''].filter(Boolean)
  let text = `## ${post.title}${badges.length ? ` [${badges.join(' ')}]` : ''}\n\n`
  text += `**作者**: ${post.author.nickname} (UID:${post.author.uid}, Lv.${post.author.level})\n`
  text += `**版块**: ${post.forum.name}${post.topics.length ? ` | 话题: ${post.topics.map((t) => `#${t}`).join(' ')}` : ''}\n`
  text += `**发布时间**: ${fmtDate(post.createdAt)}\n`
  text += `**互动**: ❤️${post.stats.like} 💬${post.stats.reply} ⭐${post.stats.collect} 👁️${post.stats.view} ↗️${post.stats.share}\n`
  text += `\n---\n\n`
  const plain = post.plainText
  text += plain.length > 3000 ? plain.slice(0, 3000) + '\n\n[...内容过长，已截断]' : plain
  if (post.images.length) {
    text += `\n\n**📸 图片列表** (共${post.images.length}张)：\n\n`
    for (const url of post.images.slice(0, 10)) text += `![](${url})\n\n`
    if (post.images.length > 10) text += `...还有${post.images.length - 10}张图片\n`
  }
  text += `\n链接: ${post.link}`
  return text
}

export function formatReplies(replies) {
  if (!replies.length) return '暂无评论。'
  let text = `**热评** (共${replies.length}条)：\n\n`
  for (const r of replies) {
    text += `- **${r.author.nickname}** (Lv.${r.author.level}) ❤️${r.like} ${fmtDate(r.createdAt)}\n`
    text += `  ${r.content.slice(0, 150)}${r.content.length > 150 ? '...' : ''}\n\n`
  }
  return text
}

function opt(ctx) {
  const m = ctx?.miyoushe || {}
  return { cookie: m.cookie || '', fetcher: ctx?.fetcher }
}

export const miyousheSearchTool = {
  name: 'miyoushe_search',
  description: '搜索米游社（米哈游社区）帖子。用于查找原神/星穹铁道/崩坏3/绝区零等米哈游游戏的攻略、公告、玩家帖子。返回帖子标题/作者/互动/摘要/帖子ID。',
  category: 'query',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: '搜索关键词' },
      game: { type: 'string', description: '游戏名或 gid（原神/星穹铁道/崩坏3/崩坏三/绝区零/未定事件簿/崩坏学院2），默认原神' },
      pageSize: { type: 'integer', description: '返回条数（1-10，默认 5）' },
    },
    required: ['keyword'],
  },
  async execute(params, ctx) {
    const m = ctx?.miyoushe || {}
    const gid = params.game ? getGameGid(params.game) : m.defaultGid || 2
    const data = await searchPosts(params.keyword, { gid, pageSize: Math.min(10, Math.max(1, params.pageSize || 5)), ...opt(ctx) })
    return formatSearchResults(data)
  },
}

export const miyoushePostTool = {
  name: 'miyoushe_post',
  description: '按帖子ID获取米游社帖子详情（正文/图片/互动数据）。先用 miyoushe_search 拿到 postId，再用本工具读全文。',
  category: 'query',
  meta: { resultCap: 12000 },
  parameters: {
    type: 'object',
    properties: {
      postId: { type: 'string', description: '米游社帖子ID' },
      game: { type: 'string', description: '游戏名或 gid（默认原神）' },
    },
    required: ['postId'],
  },
  async execute(params, ctx) {
    const m = ctx?.miyoushe || {}
    const gid = params.game ? getGameGid(params.game) : m.defaultGid || 2
    const post = await getPostDetail(params.postId, { gid, ...opt(ctx) })
    return formatPostDetail(post)
  },
}

export const miyousheRepliesTool = {
  name: 'miyoushe_replies',
  description: '按帖子ID获取米游社帖子热门评论。',
  category: 'query',
  parameters: {
    type: 'object',
    properties: {
      postId: { type: 'string', description: '米游社帖子ID' },
      game: { type: 'string', description: '游戏名或 gid（默认原神）' },
      size: { type: 'integer', description: '评论条数（默认 5）' },
    },
    required: ['postId'],
  },
  async execute(params, ctx) {
    const m = ctx?.miyoushe || {}
    const gid = params.game ? getGameGid(params.game) : m.defaultGid || 2
    const replies = await getPostReplies(params.postId, { gid, size: Math.min(20, Math.max(1, params.size || 5)), ...opt(ctx) })
    return formatReplies(replies)
  },
}

export const miyousheTools = [miyousheSearchTool, miyoushePostTool, miyousheRepliesTool]
