/**
 * 米游社（miyoushe）公共出口 —— BBS 帖子搜索 / 详情 / 评论。
 *
 * 用法（apps 层）：
 *   import { miyousheTools } from '../model/miyoushe/index.js'
 *   tools.register(...miyousheTools)
 *   // 并在 ctx 注入：ctx.miyoushe = { cookie, defaultGid }
 */

import {
  MIYOUSHE_CONFIG, GAME_GIDS, GID_PATHS, GID_NAMES,
  generateDS, buildHeaders, htmlToText, extractImagesFromHtml, parsePostFromItem,
  searchPosts, getPostDetail, getPostReplies, getGameGid, getGameList,
} from './client.js'
import { miyousheSearchTool, miyoushePostTool, miyousheRepliesTool, miyousheTools } from './tools.js'
import { formatSearchResults, formatPostDetail, formatReplies } from './tools.js'

export {
  MIYOUSHE_CONFIG, GAME_GIDS, GID_PATHS, GID_NAMES,
  generateDS, buildHeaders, htmlToText, extractImagesFromHtml, parsePostFromItem,
  searchPosts, getPostDetail, getPostReplies, getGameGid, getGameList,
  miyousheSearchTool, miyoushePostTool, miyousheRepliesTool, miyousheTools,
  formatSearchResults, formatPostDetail, formatReplies,
}
