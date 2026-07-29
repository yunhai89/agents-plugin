/**
 * 内置工具元数据入库（provenance=human, status=stable）。
 *
 * 仅注册逻辑身份 + manifest 元数据（供检索/统计/调用埋点关联 versionId）；
 * execute 仍走插件原代码（不入沙箱、不进化）。幂等：已存在则跳过。
 *
 * @param registry ToolEvoRegistry 实例
 * @param builtins [{ name, description, parameters, sideEffects[], tags[], useWhen[] }]
 */
import crypto from 'node:crypto'
import { dao } from './db.js'
import { makeManifest } from './manifest.js'

export async function seedBuiltinTools(registry, builtins = []) {
  let added = 0
  for (const b of builtins) {
    if (!b?.name) continue
    if (await registry.getByName(b.name)) continue
    const toolId = 'tool_' + crypto.randomBytes(6).toString('hex')
    await registry.createTool({ id: toolId, name: b.name, namespace: 'builtin' })
    const manifest = makeManifest({
      name: b.name,
      version: '1.0.0',
      status: 'stable',
      description: b.description || `内置工具 ${b.name}`,
      inputSchema: b.parameters || { type: 'object', properties: {} },
      tags: b.tags || [],
      useWhen: b.useWhen || [],
      permissions: {
        sideEffects: b.sideEffects || ['none'],
        network: { mode: 'deny', hosts: [] },
        filesystem: { read: [], write: [] },
        secrets: [],
      },
      provenance: { kind: 'human', createdAt: new Date().toISOString() },
    })
    // 内置工具直接 stable（人维护，跳过状态机审批）；createVersion 存 manifest.status
    const v = await registry.createVersion({ toolId, semver: '1.0.0', manifest, source: '', tests: [] })
    await dao.run(`UPDATE tools SET active_version_id=? WHERE id=?`, [v.id, toolId])
    added++
  }
  return added
}
