import crypto from 'crypto';

// ===== 米游社 API 配置 =====
const MIYOUSHE_CONFIG = {
  appVersion: '2.104.0',
  clientType: '4',
  salt: 'EJncUPGnOHajenjLhBOsdpwEMZmiCmQX',
  referer: 'https://www.miyoushe.com',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  apiBase: 'https://bbs-api.mihoyo.com',
};

// ===== 官方 gid 对照表 =====
// 1=崩坏三, 2=原神, 3=崩坏学院2, 4=未定事件簿, 6=崩坏星穹铁道, 8=绝区零
const GAME_GIDS: Record<string, number> = {
  '原神': 2, '崩坏星穹铁道': 6, '星穹铁道': 6, '崩坏3': 1, '崩坏三': 1,
  '绝区零': 8, '未定事件簿': 4, '崩坏学院2': 3,
};
const GID_PATHS: Record<number, string> = { 1: 'bh3', 2: 'ys', 3: 'bh2', 4: 'wd', 6: 'sr', 8: 'zzz' };
const GID_NAMES: Record<number, string> = { 1: '崩坏三', 2: '原神', 3: '崩坏学院2', 4: '未定事件簿', 6: '崩坏星穹铁道', 8: '绝区零' };

// ===== 工具函数 =====

function md5(text: string): string {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

function getRandomStr(length = 6): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function generateDS(salt: string): string {
  const t = Math.floor(Date.now() / 1000);
  const r = getRandomStr(6);
  return `${t},${r},${md5(`salt=${salt}&t=${t}&r=${r}`)}`;
}

function sortedQueryString(obj: Record<string, string>): string {
  if (!obj || Object.keys(obj).length === 0) return '';
  return Object.keys(obj).sort().map(key => `${key}=${obj[key]}`).join('&');
}

function buildHeaders(cookie?: string): Record<string, string> {
  const ds = generateDS(MIYOUSHE_CONFIG.salt);
  const headers: Record<string, string> = {
    'x-rpc-app_version': MIYOUSHE_CONFIG.appVersion,
    'x-rpc-client_type': MIYOUSHE_CONFIG.clientType,
    'x-rpc-device_id': crypto.randomUUID().replace(/-/g, '').toUpperCase(),
    'X-Requested-With': 'XMLHttpRequest',
    'DS': ds,
    'Referer': MIYOUSHE_CONFIG.referer,
    'User-Agent': MIYOUSHE_CONFIG.userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Origin': 'https://www.miyoushe.com',
    'Host': 'bbs-api.mihoyo.com',
  };
  if (cookie) headers['Cookie'] = cookie.replace(/[^\x20-\x7E]/g, '');
  return headers;
}

/** HTML 转纯文本（参考 post_detail.js 的 htmlToText） */
function htmlToText(html: string): string {
  if (!html) return '';
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** 从 HTML 中提取图片 URL */
function extractImagesFromHtml(html: string): string[] {
  if (!html) return [];
  const urls: string[] = [];
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) urls.push(match[1]);
  return [...new Set(urls)];
}

// ===== 类型定义 =====

export interface MiyoushePost {
  postId: string;
  title: string;
  content: string;
  plainText: string;
  summary: string;
  cover: string;
  images: string[];
  stats: { like: number; reply: number; collect: number; view: number; share: number };
  flags: { isTop: boolean; isGood: boolean; isOfficial: boolean; isOriginal: boolean };
  author: { uid: string; nickname: string; avatar: string; level: number };
  forum: { id: string; name: string };
  topics: string[];
  createdAt: number;
  link: string;
}

export interface MiyousheSearchResponse {
  keyword: string;
  posts: MiyoushePost[];
}

export interface MiyousheReply {
  replyId: string;
  content: string;
  like: number;
  author: { nickname: string; level: number };
  createdAt: number;
}

// ===== 解析函数（参考 post_detail.js parsePostDetail） =====

function parsePostFromItem(item: any, gid: number): MiyoushePost {
  const post = item.post || {};
  const user = item.user || {};
  const imageList = item.image_list || [];
  const topics = item.topics || [];
  const forum = item.forum || {};
  // 注意：帖子详情接口的状态在 post.post_status，搜索接口在 post.stat
  const postStatus = post.post_status || post.stat || {};

  const rawHtml = post.content || '';
  const plainText = htmlToText(rawHtml);
  const htmlImages = extractImagesFromHtml(rawHtml);
  const allImages = [...new Set([...imageList.map((img: any) => img.url || img), ...htmlImages])];
  const gamePath = GID_PATHS[gid] || 'ys';

  return {
    postId: post.post_id,
    title: post.subject || '',
    content: rawHtml,
    plainText,
    summary: post.summary || '',
    cover: post.cover || '',
    images: allImages,
    stats: {
      like: postStatus.like_num ?? 0,
      reply: postStatus.reply_num ?? 0,
      collect: postStatus.bookmark_num ?? postStatus.collect_num ?? 0,
      view: postStatus.view_num ?? 0,
      share: postStatus.forward_num ?? 0,
    },
    flags: {
      isTop: postStatus.is_top || false,
      isGood: postStatus.is_good || false,
      isOfficial: postStatus.is_official || false,
      isOriginal: post.is_original === 1,
    },
    author: {
      uid: user.uid || '',
      nickname: user.nickname || '匿名',
      avatar: user.avatar_url || user.avatar || '',
      level: user.level_exp?.level || 0,
    },
    forum: { id: forum.id || '', name: forum.name || '' },
    topics: topics.map((t: any) => t.name || ''),
    createdAt: post.created_at || 0,
    link: `https://www.miyoushe.com/${gamePath}/article/${post.post_id}`,
  };
}

// ===== API 调用 =====

export async function searchPosts(
  keyword: string,
  gid: number = 2,
  page: number = 1,
  pageSize: number = 5,
  cookie?: string,
): Promise<MiyousheSearchResponse> {
  const queryObj: Record<string, string> = {
    gids: String(gid), keyword, page: String(page), page_size: String(pageSize),
  };
  const queryStr = sortedQueryString(queryObj);
  const url = `${MIYOUSHE_CONFIG.apiBase}/post/wapi/searchPosts?${queryStr}`;

  const response = await fetch(url, { method: 'GET', headers: buildHeaders(cookie) });
  if (!response.ok) throw new Error(`米游社搜索请求失败: ${response.status}`);

  const data = await response.json() as any;
  if (data.retcode !== 0) throw new Error(`米游社 API 错误: [${data.retcode}] ${data.message}`);

  const posts = (data.data?.posts || []).map((item: any) => parsePostFromItem(item, gid));
  return { keyword, posts };
}

export async function getPostDetail(
  postId: string,
  gid: number = 2,
  cookie?: string,
): Promise<MiyoushePost> {
  const queryObj: Record<string, string> = {
    gids: String(gid), post_id: String(postId), read: '1',
  };
  const queryStr = sortedQueryString(queryObj);
  const url = `${MIYOUSHE_CONFIG.apiBase}/post/wapi/getPostFull?${queryStr}`;

  const response = await fetch(url, { method: 'GET', headers: buildHeaders(cookie) });
  if (!response.ok) throw new Error(`米游社帖子详情请求失败: ${response.status}`);

  const data = await response.json() as any;
  if (data.retcode !== 0) throw new Error(`米游社 API 错误: [${data.retcode}] ${data.message}`);

  return parsePostFromItem(data.data?.post || {}, gid);
}

export async function getPostReplies(
  postId: string,
  gid: number = 2,
  isHot: boolean = true,
  size: number = 5,
  cookie?: string,
): Promise<MiyousheReply[]> {
  const queryObj: Record<string, string> = {
    gids: String(gid), is_hot: String(isHot), post_id: String(postId), size: String(size),
  };
  const queryStr = sortedQueryString(queryObj);
  const url = `${MIYOUSHE_CONFIG.apiBase}/post/wapi/getPostReplies?${queryStr}`;

  const response = await fetch(url, { method: 'GET', headers: buildHeaders(cookie) });
  if (!response.ok) return [];

  const data = await response.json() as any;
  if (data.retcode !== 0) return [];

  return (data.data?.list || []).map((item: any) => {
    const reply = item.reply || item;
    const user = item.user || {};
    return {
      replyId: reply.reply_id || '',
      content: htmlToText(reply.content || ''),
      like: reply.like_num || 0,
      author: { nickname: user.nickname || '匿名', level: user.level_exp?.level || 0 },
      createdAt: reply.created_at || 0,
    };
  });
}

// ===== 格式化输出（给 AI 看，AI 会把内容传给用户） =====

export function formatSearchResults(data: MiyousheSearchResponse): string {
  if (data.posts.length === 0) return `米游社搜索「${data.keyword}」没有找到相关帖子。`;

  let text = `**米游社搜索结果**（关键词: ${data.keyword}）：\n\n`;
  for (const p of data.posts) {
    const date = p.createdAt ? new Date(p.createdAt * 1000).toLocaleDateString('zh-CN') : '';
    const tags = p.topics.length > 0 ? ` ${p.topics.map(t => `#${t}`).join(' ')}` : '';
    const badges = [
      p.flags.isTop ? '置顶' : '', p.flags.isGood ? '精华' : '', p.flags.isOfficial ? '官方' : '',
    ].filter(Boolean).join(' ');
    text += `- **${p.title}**${badges ? ` [${badges}]` : ''}${tags}\n`;
    text += `  作者: ${p.author.nickname} (Lv.${p.author.level}) | ❤️${p.stats.like} 💬${p.stats.reply} ⭐${p.stats.collect} 👁️${p.stats.view} | ${date}\n`;
    if (p.summary) text += `  ${p.summary.slice(0, 150)}\n`;
    text += `  帖子ID: ${p.postId} | 链接: ${p.link}\n\n`;
  }
  text += `查看帖子详情请提供帖子ID。`;
  return text;
}

export function formatPostDetail(post: MiyoushePost): string {
  const badges = [
    post.flags.isTop ? '置顶' : '', post.flags.isGood ? '精华' : '',
    post.flags.isOfficial ? '官方' : '', post.flags.isOriginal ? '原创' : '',
  ].filter(Boolean);

  let text = `## ${post.title}${badges.length ? ` [${badges.join(' ')}]` : ''}\n\n`;
  text += `**作者**: ${post.author.nickname} (UID:${post.author.uid}, Lv.${post.author.level})\n`;
  text += `**版块**: ${post.forum.name}${post.topics.length > 0 ? ` | 话题: ${post.topics.map(t => `#${t}`).join(' ')}` : ''}\n`;
  text += `**发布时间**: ${new Date(post.createdAt * 1000).toLocaleString('zh-CN')}\n`;
  text += `**互动**: ❤️${post.stats.like} 💬${post.stats.reply} ⭐${post.stats.collect} 👁️${post.stats.view} ↗️${post.stats.share}\n`;
  text += `\n---\n\n`;

  // 正文
  const plainText = post.plainText;
  if (plainText.length > 3000) {
    text += plainText.slice(0, 3000) + '\n\n[...内容过长，已截断]';
  } else {
    text += plainText;
  }

  // 图片（使用 markdown 图片语法，AI 需要在回复中渲染这些图片）
  if (post.images.length > 0) {
    text += `\n\n**📸 图片列表** (共${post.images.length}张，请在回复中用 markdown 图片语法渲染)：\n\n`;
    for (const url of post.images.slice(0, 10)) {
      text += `![](${url})\n\n`;
    }
    if (post.images.length > 10) text += `...还有${post.images.length - 10}张图片\n`;
  }

  text += `\n链接: ${post.link}`;
  return text;
}

export function formatReplies(replies: MiyousheReply[]): string {
  if (replies.length === 0) return '暂无评论。';
  let text = `**热评** (共${replies.length}条)：\n\n`;
  for (const r of replies) {
    const date = r.createdAt ? new Date(r.createdAt * 1000).toLocaleString('zh-CN') : '';
    text += `- **${r.author.nickname}** (Lv.${r.author.level}) ❤️${r.like} ${date}\n`;
    text += `  ${r.content.slice(0, 150)}${r.content.length > 150 ? '...' : ''}\n\n`;
  }
  return text;
}

// ===== 辅助函数 =====

export function getGameGid(gameName: string): number {
  if (GAME_GIDS[gameName] !== undefined) return GAME_GIDS[gameName];
  for (const [name, gid] of Object.entries(GAME_GIDS)) {
    if (gameName.includes(name) || name.includes(gameName)) return gid;
  }
  return 2;
}

export function getGameList(): string {
  return Object.entries(GID_NAMES).map(([gid, name]) => `${name}(gid=${gid})`).join('、');
}
