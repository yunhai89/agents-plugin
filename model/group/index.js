/**
 * 群聊工具公共出口（内置工具包）—— 群信息获取 + 群管理。
 *
 * 信息（读）：group_info / group_member / group_members / user_info
 * 管理（写）：group_kick / group_mute / group_mute_all / group_set_card / group_set_title / group_set_admin / group_set_name
 *
 * 用法：tools.register(...groupInfoTools, ...groupManageTools)
 * RBAC 由 Agent 的 policy 自动门控（system 默认仅 master，group_manage 群管以上）。
 */

import { groupInfoTool, groupMemberTool, groupMembersTool, userInfoTool, groupInfoTools } from './info.js'
import {
  groupKickTool, groupMuteTool, groupMuteAllTool,
  groupSetCardTool, groupSetTitleTool, groupSetAdminTool, groupSetNameTool,
  groupManageTools,
} from './manage.js'

/** 经 toolkit.defineToolPack 包装的统一工具包（带 group 命名空间，可选） */
export const groupTools = [...groupInfoTools, ...groupManageTools]

export {
  groupInfoTool, groupMemberTool, groupMembersTool, userInfoTool, groupInfoTools,
  groupKickTool, groupMuteTool, groupMuteAllTool,
  groupSetCardTool, groupSetTitleTool, groupSetAdminTool, groupSetNameTool,
  groupManageTools,
}
