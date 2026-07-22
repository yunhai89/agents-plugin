/**
 * 一次性提醒 —— 经注入的 scheduler（默认 node-schedule 适配器）+ KV 持久化 + 重启恢复。
 * 对应 yunhai lib/agent/schedule.js。fire 回调由调用方注入（解耦 QQ 发送路径）。
 *
 * 库本体不 import node-schedule（保持离线可测）；apps 用 nodeScheduleAdapter() 装配，测试注入 fake scheduler。
 */

export class ScheduleStore {
  constructor({ kv, prefix = 'Yz:agent:rem:', scheduler } = {}) {
    if (!kv) throw new Error('ScheduleStore 需要 kv')
    if (!scheduler) throw new Error('ScheduleStore 需要 scheduler（{ scheduleJob(date, fn), cancelJob(job) }）')
    this.kv = kv
    this.prefix = prefix
    this.scheduler = scheduler
    this._jobs = new Map()
    this._seq = 0
  }

  _key() { return `${this.prefix}jobs` }
  async _load() { const v = await this.kv.get(this._key()); return Array.isArray(v) ? v : [] }
  async _save(arr) { await this.kv.set(this._key(), arr) }
  _nextId() { this._seq = (this._seq + 1) % 100000; return String(this._seq).padStart(5, '0') }

  async add(info, fire) {
    const arr = await this._load()
    const id = info.id || this._nextId()
    const at = info.at instanceof Date ? info.at.getTime() : Number(info.at)
    const rec = { id, userId: info.userId, groupId: info.groupId, selfId: info.selfId, at, message: info.message }
    arr.push(rec)
    await this._save(arr)
    this._schedule(rec, fire)
    return rec
  }

  _schedule(rec, fire) {
    const job = this.scheduler.scheduleJob(new Date(rec.at), async () => {
      try { await fire?.(rec) } catch { /* noop */ }
      try { await this.cancel(rec.id) } catch { /* noop */ }
    })
    this._jobs.set(rec.id, { job, info: rec })
  }

  async cancel(id) {
    const j = this._jobs.get(id)
    if (j?.job) this.scheduler.cancelJob(j.job)
    this._jobs.delete(id)
    const arr = (await this._load()).filter((r) => r.id !== id)
    await this._save(arr)
  }

  async listByUser(userId) { return (await this._load()).filter((r) => r.userId === userId).sort((a, b) => a.at - b.at) }
  async listAll() { return (await this._load()).sort((a, b) => a.at - b.at) }

  /** 重启恢复：重排未到期项，丢弃过期项 */
  async restore(fire) {
    const arr = await this._load()
    const now = Date.now()
    const live = []
    for (const rec of arr) {
      if (rec.at > now) {
        live.push(rec)
        this._schedule(rec, fire)
      }
    }
    if (live.length !== arr.length) await this._save(live)
    return { restored: live.length, dropped: arr.length - live.length }
  }
}

/** 便利适配器：在 apps 里装配真实 node-schedule */
export async function nodeScheduleAdapter() {
  const mod = await import('node-schedule')
  const schedule = mod.default || mod
  return {
    scheduleJob(date, fn) { return schedule.scheduleJob(date, fn) },
    cancelJob(job) { job?.cancel?.() },
  }
}
