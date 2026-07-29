/**
 * ToolEvoRegistry：版本化工具注册表（DB + 文件制品双写）。
 *
 * - createTool / createVersion（不可变版本，parent 链，(tool_id,semver) 唯一）
 * - getVersion / listVersions / getByName
 * - setStatus（走 lifecycle 状态机校验；→stable 时回填 tools.active_version_id + 审批记录）
 * - listStable + toToolContract：stable 版本导出为 ToolRegistry 契约 {name,description,parameters,execute}
 *   （execute 由 sandbox runner 执行候选 source，阶段2 接入；阶段0 此处占位）
 *
 * 文件制品：data/evolution/tools/<name>/<semver>/{TOOL.md, index.js, manifest.json, tests.json}
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { dao } from './db.js'
import { canTransition, isValidState } from './lifecycle.js'
import { validateManifest } from './manifest.js'

export class ToolEvoRegistry {
  constructor({ artifactsDir }) {
    this.artifactsDir = artifactsDir
    fs.mkdirSync(artifactsDir, { recursive: true })
  }

  /** 创建工具逻辑身份（id 唯一，name 唯一） */
  async createTool({ id, name, namespace = 'default' }) {
    await dao.run(`INSERT INTO tools(id,name,namespace,created_at) VALUES(?,?,?,?)`, [id, name, namespace, Date.now()])
    return id
  }

  async getByName(name) { return dao.get(`SELECT * FROM tools WHERE name=?`, [name]) }
  async getById(id) { return dao.get(`SELECT * FROM tools WHERE id=?`, [id]) }

  /** 创建不可变版本（DB + 文件制品双写）。manifest 必须先过 validateManifest。 */
  async createVersion({ toolId, semver, manifest, source, tests = [], parentVersionId = null, generatorModel = null }) {
    const v = validateManifest(manifest)
    if (!v.ok) throw new Error('manifest 校验失败: ' + v.errors.join('; '))
    const exist = await dao.get(`SELECT 1 FROM tool_versions WHERE tool_id=? AND semver=?`, [toolId, semver])
    if (exist) throw new Error(`版本已存在 ${toolId}@${semver}（版本不可变，修订请新 semver）`)
    const id = 'tv_' + crypto.randomBytes(8).toString('hex')
    const sourceHash = crypto.createHash('sha256').update(source || '').digest('hex')
    await dao.run(
      `INSERT INTO tool_versions(id,tool_id,semver,status,source_hash,manifest_json,parent_version_id,generator_model,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      [id, toolId, semver, manifest.status || 'draft', sourceHash, JSON.stringify(manifest), parentVersionId, generatorModel, Date.now()],
    )
    for (const t of tests) {
      const tid = 'tt_' + crypto.randomBytes(6).toString('hex')
      await dao.run(`INSERT INTO tool_tests(id,version_id,kind,name,fixture_json,oracle_json) VALUES(?,?,?,?,?,?)`,
        [tid, id, t.kind || 'unit', t.name || null, JSON.stringify(t.input ?? null), JSON.stringify(t.expected ?? null)])
    }
    this._writeArtifacts(manifest.name, semver, { manifest, source, tests })
    return { id, toolId, semver, status: manifest.status || 'draft', sourceHash }
  }

  _writeArtifacts(name, semver, { manifest, source, tests }) {
    const dir = path.join(this.artifactsDir, name, semver)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    fs.writeFileSync(path.join(dir, 'index.js'), source || '')
    fs.writeFileSync(path.join(dir, 'tests.json'), JSON.stringify(tests, null, 2))
    const md = `# ${manifest.name} v${semver}\n\n${manifest.description}\n\n**useWhen**\n- ${(manifest.useWhen || []).join('\n- ')}\n\n**doNotUseWhen**\n- ${(manifest.doNotUseWhen || []).join('\n- ')}\n\n**sideEffects**: ${(manifest.permissions?.sideEffects || []).join(',')}\n`
    fs.writeFileSync(path.join(dir, 'TOOL.md'), md)
  }

  async getVersion(versionId) {
    const row = await dao.get(`SELECT * FROM tool_versions WHERE id=?`, [versionId])
    return row ? { ...row, manifest: JSON.parse(row.manifest_json) } : null
  }

  async listVersions({ toolId, status } = {}) {
    const where = [], params = []
    if (toolId) { where.push('tool_id=?'); params.push(toolId) }
    if (status) { where.push('status=?'); params.push(status) }
    const sql = `SELECT id,tool_id,semver,status,source_hash,generator_model,created_at FROM tool_versions${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`
    return dao.all(sql, params)
  }

  /** 改状态（状态机校验） */
  async setStatus(versionId, to, { actor, reason } = {}) {
    const v = await this.getVersion(versionId)
    if (!v) throw new Error('版本不存在')
    if (!isValidState(to)) throw new Error('非法状态: ' + to)
    if (v.status === to) return v
    if (!canTransition(v.status, to)) throw new Error(`非法转移 ${v.status} → ${to}`)
    await dao.run(`UPDATE tool_versions SET status=? WHERE id=?`, [to, versionId])
    if (to === 'stable') await dao.run(`UPDATE tools SET active_version_id=? WHERE id=?`, [versionId, v.tool_id])
    if (actor) await this._recordApproval(versionId, actor, to, reason)
    return { ...v, status: to }
  }

  async _recordApproval(versionId, actor, decision, reason) {
    const id = 'ap_' + crypto.randomBytes(6).toString('hex')
    await dao.run(`INSERT INTO approval_records(id,version_id,actor,scope,decision,reason,created_at) VALUES(?,?,?,?,?,?,?)`,
      [id, versionId, actor, 'toolEvo', decision, reason || null, Date.now()])
  }

  /** 所有 stable 工具（供注入 ToolRegistry） */
  async listStable() {
    const rows = await dao.all(
      `SELECT tv.id AS version_id, tv.tool_id, tv.semver, tv.manifest_json, t.name
       FROM tool_versions tv JOIN tools t ON t.id=tv.tool_id
       WHERE tv.status='stable' ORDER BY tv.created_at DESC`,
    )
    return rows.map((r) => ({ versionId: r.version_id, toolId: r.tool_id, name: r.name, semver: r.semver, manifest: JSON.parse(r.manifest_json) }))
  }

  /**
   * 导出为 ToolRegistry 契约；execute = dynamic import 制品 index.js 的 run。
   * stable 已过 AST + 行为验证（阶段1/2），运行时不再 sandbox（直接 run，性能开销小）。
   * 制品文件不可变（版本目录），Node 模块缓存复用。
   */
  async toToolContract(stable) {
    const dir = path.join(this.artifactsDir, stable.manifest.name, stable.semver)
    const fileUrl = pathToFileURL(path.join(dir, 'index.js')).href
    let mod
    try { mod = await import(fileUrl) }
    catch (e) { throw new Error(`加载工具制品失败（${stable.manifest.name}@${stable.semver}）：${e?.message || e}`) }
    if (typeof mod.run !== 'function') throw new Error(`工具制品未导出 run：${stable.manifest.name}@${stable.semver}`)
    return {
      name: stable.manifest.name,
      description: stable.manifest.description,
      parameters: stable.manifest.inputSchema,
      category: 'evolved',
      meta: { toolEvoVersionId: stable.versionId, sideEffects: stable.manifest.permissions.sideEffects },
      async execute(params, ctx) { return mod.run(params, ctx) },
    }
  }
}

export default ToolEvoRegistry
