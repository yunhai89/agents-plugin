/**
 * 群文件管理工具（内置）—— NapCat 原生群文件 CRUD。
 *
 * 覆盖：上传/删除文件、创建/删除文件夹、列目录、取直链、移动、重命名、跨群转发。
 * 与 media/tool.js 的 list_group_files/get_group_file（基于 g.fs 封装）互补：
 * 本组走 e.bot.sendApi 原生动作，能力更全（移动/重命名/跨群/直链等）。
 *
 * RBAC：读类 query；建文件夹/移动/重命名/上传/转发 group_manage（群管）；
 *      删文件/删文件夹 system（master，destructive）。删除/上传标 interactive 确保顺序确认。
 */

import { defineTool, param, groupIdOf, sendApi } from '../toolkit/index.js'

function needGid(ctx, groupId) {
  return groupIdOf(ctx, groupId) || null
}

/** 归一化群文件系统返回的 files/folders（OneBot 各端字段不一） */
function normFs(data) {
  const files = [].concat(data?.files || []).map((f) => ({
    fileId: f.file_id || f.id || f.fid || null,
    name: f.file_name || f.name || f.fileName || null,
    size: f.file_size || f.size ? Number(f.file_size || f.size) : null,
    busid: f.busid ?? null,
    pid: f.parent_directory || f.pid || null,
  })).filter((x) => x.fileId || x.name)
  const folders = [].concat(data?.folders || data?.directory || []).map((d) => ({
    folderId: d.folder_id || d.dir_id || d.id || null,
    name: d.folder_name || d.dir_name || d.name || null,
    pid: d.parent_directory || d.pid || null,
  })).filter((x) => x.folderId || x.name)
  return { files, folders }
}

/** upload_group_file：上传文件到群文件（可指定目标文件夹） */
export const uploadGroupFileTool = defineTool({
  name: 'upload_group_file',
  description: '上传文件到群文件系统。file 支持本地路径/URL/base64。可选 folder 指定目标文件夹 id。会审批。',
  category: 'group_manage',
  meta: { interactive: true },
  parameters: param.object({
    file: param.str('文件路径、URL 或 base64:// 编码'),
    name: param.str('上传后的文件名（含扩展名）'),
    folder: param.str('目标文件夹 id（可选，默认根目录）'),
    groupId: param.str('群号（可选，默认当前群）'),
  }, ['file', 'name']),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const r = await sendApi(ctx, 'upload_group_file', {
      group_id: gid, file: String(p.file), name: String(p.name),
      ...(p.folder ? { folder: String(p.folder) } : {}),
    })
    if (!r.ok) return { error: r.error }
    return { ok: true, groupId: gid, uploaded: p.name }
  },
})

/** delete_group_file：删除群文件 */
export const deleteGroupFileTool = defineTool({
  name: 'delete_group_file',
  description: '删除群文件系统中的文件（需 master，destructive，会审批）。需 file_id 与 busid（从列目录工具获取）。',
  category: 'system',
  meta: { interactive: true },
  parameters: param.object({
    fileId: param.str('文件 id'),
    busid: param.int('文件 busid（从列目录获取）'),
    groupId: param.str('群号（可选，默认当前群）'),
  }, ['fileId']),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const r = await sendApi(ctx, 'delete_group_file', {
      group_id: gid, file_id: String(p.fileId),
      ...(p.busid != null ? { busid: Number(p.busid) } : {}),
    })
    if (!r.ok) return { error: r.error }
    return { ok: true, groupId: gid, fileId: p.fileId, deleted: true }
  },
})

/** create_group_folder：创建群文件文件夹 */
export const createGroupFolderTool = defineTool({
  name: 'create_group_folder',
  description: '在群文件根目录创建新文件夹。',
  category: 'group_manage',
  parameters: param.object({
    name: param.str('文件夹名称'),
    groupId: param.str('群号（可选，默认当前群）'),
  }, ['name']),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const r = await sendApi(ctx, 'create_group_file_folder', { group_id: gid, name: String(p.name) })
    if (!r.ok) return { error: r.error }
    return { ok: true, groupId: gid, folder: p.name }
  },
})

/** delete_group_folder：删除群文件文件夹 */
export const deleteGroupFolderTool = defineTool({
  name: 'delete_group_folder',
  description: '删除群文件中的文件夹（需 master，destructive，会审批）。',
  category: 'system',
  meta: { interactive: true },
  parameters: param.object({
    folderId: param.str('文件夹 id'),
    groupId: param.str('群号（可选，默认当前群）'),
  }, ['folderId']),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const r = await sendApi(ctx, 'delete_group_folder', { group_id: gid, folder_id: String(p.folderId) })
    if (!r.ok) return { error: r.error }
    return { ok: true, groupId: gid, folderId: p.folderId, deleted: true }
  },
})

/** list_group_folder：列群文件目录（不传 folderId=根目录） */
export const listGroupFolderTool = defineTool({
  name: 'list_group_folder',
  description: '列出群文件目录内容（文件+文件夹）。不传 folderId 列根目录。先列根目录拿 folder_id 再列子目录。',
  category: 'query',
  meta: { resultCap: 8000 },
  parameters: param.object({
    folderId: param.str('文件夹 id（可选，默认根目录）'),
    groupId: param.str('群号（可选，默认当前群）'),
  }),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const action = p.folderId ? 'get_group_files_by_folder' : 'get_group_root_files'
    const r = await sendApi(ctx, action, p.folderId ? { group_id: gid, folder_id: String(p.folderId) } : { group_id: gid })
    if (!r.ok) return { error: r.error }
    const { files, folders } = normFs(r.data || {})
    return { ok: true, groupId: gid, scope: p.folderId ? 'subfolder' : 'root', folderId: p.folderId || null, fileCount: files.length, folderCount: folders.length, files, folders }
  },
})

/** get_group_file_url：取群文件下载直链 */
export const getGroupFileUrlTool = defineTool({
  name: 'get_group_file_url',
  description: '获取群文件的下载直链（fileId+busid 从列目录工具获取）。直链供下载或交其它工具识别。',
  category: 'query',
  parameters: param.object({
    fileId: param.str('文件 id'),
    busid: param.int('文件 busid'),
    groupId: param.str('群号（可选，默认当前群）'),
  }, ['fileId']),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const r = await sendApi(ctx, 'get_group_file_url', {
      group_id: gid, file_id: String(p.fileId),
      ...(p.busid != null ? { busid: Number(p.busid) } : {}),
    })
    if (!r.ok) return { error: r.error }
    return { ok: true, groupId: gid, fileId: p.fileId, url: r.data?.url || r.data || null }
  },
})

/** move_group_file：移动群文件到指定文件夹 */
export const moveGroupFileTool = defineTool({
  name: 'move_group_file',
  description: '把群文件移动到另一个文件夹（targetDir=目标文件夹 id）。',
  category: 'group_manage',
  parameters: param.object({
    fileId: param.str('文件 id'),
    targetDir: param.str('目标文件夹 id（根目录传空串或对应根 id）'),
    groupId: param.str('群号（可选，默认当前群）'),
  }, ['fileId', 'targetDir']),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const r = await sendApi(ctx, 'move_group_file', { group_id: gid, file_id: String(p.fileId), target_dir: String(p.targetDir) })
    if (!r.ok) return { error: r.error }
    return { ok: true, groupId: gid, fileId: p.fileId, movedTo: p.targetDir }
  },
})

/** rename_group_file：重命名群文件 */
export const renameGroupFileTool = defineTool({
  name: 'rename_group_file',
  description: '重命名群文件。需 file_id、新名、当前父目录 id（根目录传空串）。',
  category: 'group_manage',
  parameters: param.object({
    fileId: param.str('文件 id'),
    newName: param.str('新文件名'),
    currentParentDirectory: param.str('当前所在文件夹 id（根目录传空串，可选）'),
    groupId: param.str('群号（可选，默认当前群）'),
  }, ['fileId', 'newName']),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const r = await sendApi(ctx, 'rename_group_file', {
      group_id: gid, file_id: String(p.fileId),
      new_name: String(p.newName),
      current_parent_directory: String(p.currentParentDirectory || ''),
    })
    if (!r.ok) return { error: r.error }
    return { ok: true, groupId: gid, fileId: p.fileId, renamedTo: p.newName }
  },
})

/** transfer_group_file：把群文件转发到另一个群 */
export const transferGroupFileTool = defineTool({
  name: 'transfer_group_file',
  description: '把本群的某文件转发到另一个群（需 file_id 与目标群号）。',
  category: 'group_manage',
  parameters: param.object({
    fileId: param.str('文件 id'),
    targetGroupId: param.str('目标群号'),
    groupId: param.str('源群号（可选，默认当前群）'),
  }, ['fileId', 'targetGroupId']),
  async execute(p, ctx) {
    const gid = needGid(ctx, p.groupId)
    if (!gid) return { error: '当前非群聊且未指定 groupId' }
    const r = await sendApi(ctx, 'trans_group_file', {
      group_id: gid, file_id: String(p.fileId), target_group_id: String(p.targetGroupId),
    })
    if (!r.ok) return { error: r.error }
    return { ok: true, fromGroup: gid, toGroup: p.targetGroupId, fileId: p.fileId, transferred: true }
  },
})

export const groupFileTools = [
  uploadGroupFileTool, deleteGroupFileTool, createGroupFolderTool, deleteGroupFolderTool,
  listGroupFolderTool, getGroupFileUrlTool, moveGroupFileTool, renameGroupFileTool, transferGroupFileTool,
]
