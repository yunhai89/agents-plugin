/**
 * 群聊工具公共出口（内置工具包）—— 群信息获取 + 群管理 + 群公告 + 群文件 + AI语音 + 合并转发。
 *
 * 信息（读）：group_info / group_member / group_members / user_info
 * 管理（写）：group_kick / group_mute / group_mute_all / group_set_card / group_set_title / group_set_admin / group_set_name
 * 公告：send_group_notice / get_group_notice / delete_group_notice
 * 群文件 CRUD：upload_group_file / delete_group_file / create_group_folder / delete_group_folder / list_group_folder / get_group_file_url / move_group_file / rename_group_file / transfer_group_file
 * AI 语音：get_ai_characters / ai_tts / send_group_ai_record
 * 合并转发：send_forward_msg / get_forward_msg
 *
 * 用法：tools.register(...groupInfoTools, ...groupManageTools, ...groupNoticeTools, ...)
 * RBAC 由 Agent 的 policy 自动门控（system 默认仅 master，group_manage 群管以上）。
 */

import { groupInfoTool, groupMemberTool, groupMembersTool, userInfoTool, groupInfoTools } from './info.js'
import {
  groupKickTool, groupMuteTool, groupMuteAllTool,
  groupSetCardTool, groupSetTitleTool, groupSetAdminTool, groupSetNameTool,
  groupManageTools,
} from './manage.js'
import { chatHistoryTool, groupHistoryTools } from './history.js'
import { groupNoticeTools } from './notice.js'
import { groupFileTools } from './files.js'
import { aiVoiceTools } from './ai.js'
import { forwardTools } from './forward.js'

/** 经 toolkit.defineToolPack 包装的统一工具包（带 group 命名空间，可选） */
export const groupTools = [
  ...groupInfoTools, ...groupManageTools, ...groupHistoryTools,
  ...groupNoticeTools, ...groupFileTools, ...aiVoiceTools, ...forwardTools,
]

export {
  groupInfoTool, groupMemberTool, groupMembersTool, userInfoTool, groupInfoTools,
  groupKickTool, groupMuteTool, groupMuteAllTool,
  groupSetCardTool, groupSetTitleTool, groupSetAdminTool, groupSetNameTool,
  groupManageTools,
  chatHistoryTool, groupHistoryTools,
  groupNoticeTools,
  groupFileTools,
  aiVoiceTools,
  forwardTools,
}
