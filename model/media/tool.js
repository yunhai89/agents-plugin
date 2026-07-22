/**
 * 媒体被动模式工具 —— LLM 根据用户提问**主动**取文件。
 *
 * 与主动模式（collect.js 自动随消息收集）互补：用户没附带文件、但问题指向某个文件时，
 * 模型可调用这些工具去群里 / 聊天记录 / 本次会话已收集的附件里取。
 *
 * 工具通过 ctx 读取运行时（ctx.e = Yunzai 事件，ctx.bot = Bot 句柄，ctx.media = 本次主动收集的附件），
 * 因此工具可在 buildRuntime 一次性注册，跨会话复用，无需每条消息重建。
 *
 * 三个工具：
 *  - list_group_files（group_manage）列出群文件
 *  - get_group_file  （group_manage）按名称/fid 下载群文件 → 文本类返回内容、二进制返回元信息
 *  - read_attachment （query）      读取本次会话已主动收集的附件
 */

import { resolveMedia, isTextLike, isTextLike as _isText, truncateText, mimeFromName } from './resolve.js'

function noFs(ctx) {
  return { error: '当前会话不支持群文件操作（需在群内且协议端提供 fs.ls/download）' }
}

function pickGroup(ctx) {
  return ctx?.e?.group || ctx?.bot?.pickGroup?.(ctx?.e?.group_id) || null
}

/** 归一化群文件列表项（OneBot 各端字段不一） */
function normFsItem(it) {
  return {
    name: it.file_name || it.name || it.fileName || null,
    fid: it.file_id || it.id || it.fid || null,
    busid: it.busid ?? null,
    size: it.file_size || it.size ? Number(it.file_size || it.size) : null,
    isDir: !!(it.folder || it.is_dir || it.type === 'folder'),
  }
}

export const listGroupFilesTool = {
  name: 'list_group_files',
  description: '列出当前 QQ 群的群文件。用户问"群里那个文件"/"群文件有哪些"时调用。返回文件名/大小/fid。',
  category: 'group_manage',
  parameters: {
    type: 'object',
    properties: {
      folder: { type: 'string', description: '可选：子文件夹 id（默认根目录）' },
    },
  },
  async execute(params, ctx) {
    const g = pickGroup(ctx)
    const fs = g?.fs
    if (!fs?.ls) return noFs(ctx)
    let raw
    try { raw = await fs.ls(params.folder || undefined) } catch (e) { return { error: `列群文件失败：${e?.message || e}` } }
    const data = (raw?.files || raw?.fileList || [].concat(raw || [])).map(normFsItem).filter((x) => x.name || x.fid)
    const withUrl = raw?.url || raw ? data : data
    return { count: withUrl.length, files: withUrl.slice(0, 50) }
  },
}

export const getGroupFileTool = {
  name: 'get_group_file',
  description: '下载并读取群文件内容。按 name（文件名，模糊匹配）或 fid（群文件 id）定位。文本类（txt/md/csv/json/代码/文档等）直接返回内容；图片/二进制返回元信息（当前工具结果不支持内联图片）。',
  category: 'group_manage',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '群文件名（与 fid 二选一）' },
      fid: { type: 'string', description: '群文件 id（与 name 二选一）' },
    },
  },
  async execute(params, ctx) {
    const g = pickGroup(ctx)
    const fs = g?.fs
    if (!fs?.ls || !fs.download) return noFs(ctx)
    let fid = params.fid || null
    let busid = null
    let name = params.name || null
    if (!fid) {
      if (!name) return { error: '需提供 name 或 fid' }
      let list
      try { list = await fs.ls() } catch (e) { return { error: `列群文件失败：${e?.message || e}` } }
      const items = (list?.files || [].concat(list || [])).map(normFsItem)
      const hit = items.find((it) => it.name === name) || items.find((it) => it.name?.includes(name))
      if (!hit) return { error: `群文件未找到：${name}` }
      fid = hit.fid
      busid = hit.busid
      name = hit.name
    }
    // 取下载链接
    let url
    try { url = (await fs.download(fid, busid))?.url } catch (e) { return { error: `取群文件链接失败：${e?.message || e}` } }
    if (!url) return { error: '未能获取群文件下载链接' }
    const mf = { name: name || fid, url, fid, busid, kind: 'file' }
    await resolveMedia(mf, { bot: ctx?.bot, fetcher: ctx?.fetcher })
    if (mf.resolveError || !mf.buffer) return { name: mf.name, url, error: `下载失败：${mf.resolveError || '未知'}` }
    if (isTextLike(mf.mime)) {
      return { name: mf.name, size: mf.bytes, mime: mf.mime, content: truncateText(mf.buffer) }
    }
    return { name: mf.name, size: mf.bytes, mime: mf.mime, note: '非文本文件，工具结果不支持内联展示；如需识别请让用户直接发送该文件。' }
  },
}

export const readAttachmentTool = {
  name: 'read_attachment',
  description: '读取本次对话用户已发送（被自动收集）的附件内容。文本类（txt/csv/json/代码等）返回内容；图片/二进制返回元信息（图片已在对话上下文中随消息发送，通常无需再读）。',
  category: 'query',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '附件名（模糊匹配，与 index 二选一）' },
      index: { type: 'integer', description: '附件序号（从 1 开始，与 name 二选一）' },
    },
  },
  async execute(params, ctx) {
    const active = Array.isArray(ctx?.media) ? ctx.media : ctx?.media?.active || []
    if (!active.length) return { error: '本次对话没有已收集的附件' }
    let mf
    if (params.name) mf = active.find((m) => m.name === params.name) || active.find((m) => m.name?.includes(params.name))
    else if (params.index != null) mf = active[(Number(params.index) || 1) - 1]
    else mf = active[0]
    if (!mf) return { error: '未找到匹配的附件', available: active.map((m) => m.name) }
    if (mf.resolveError || !mf.buffer) return { name: mf.name, error: `附件未就绪：${mf.resolveError || '未下载'}` }
    if (isTextLike(mf.mime)) {
      return { name: mf.name, size: mf.bytes, mime: mf.mime, content: truncateText(mf.buffer) }
    }
    return { name: mf.name, size: mf.bytes, mime: mf.mime, source: mf.source, note: '图片/二进制附件已随消息进入上下文，无需重复读取。' }
  },
}

/** 一次性注册用：返回三个被动工具数组（供 ToolRegistry.register(...tools)） */
export function makeMediaTools() {
  return [listGroupFilesTool, getGroupFileTool, readAttachmentTool]
}
