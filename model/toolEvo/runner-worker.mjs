/**
 * toolEvo stable 工具隔离执行 worker（子进程入口，由 RunnerClient fork）。
 *
 * 通过 IPC 收 {id, artifactPath, params} → import 制品的 run → 用 capabilityCtx 调用 → 回 {id, ok, output/error}。
 * capabilityCtx = Object.freeze({ now, log })——**绝不**暴露 e/bot/fetcher/process（审计 §4.2 阻断级）。
 * 制品在子进程内 import 后缓存（Map），崩溃由主进程重启 worker 重建。
 */
const cache = new Map() // artifactPath → mod

process.on('message', async (msg) => {
  if (!msg || !msg.id) return
  const { id, artifactPath, params } = msg
  try {
    let mod = cache.get(artifactPath)
    if (!mod) { mod = await import(artifactPath); cache.set(artifactPath, mod) }
    if (typeof mod.run !== 'function') {
      return process.send({ id, ok: false, error: '工具制品未导出 run 函数' })
    }
    // 冻结的 capability ctx：仅 now/log，无任何宿主能力
    const ctx = Object.freeze({
      now: () => new Date().toISOString(),
      log: (...a) => { try { process.send({ type: 'log', id, args: a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) }) } catch { /* noop */ } },
    })
    const output = await mod.run(params, ctx)
    process.send({ id, ok: true, output })
  } catch (e) {
    process.send({ id, ok: false, error: e?.message || String(e), errorClass: e?.name || 'Error' })
  }
})
