/**
 * KV 抽象 —— 让 session/recall/schedule 等运营层既能用 Yunzai 的 global.redis，又能用内存回退（离线测试）。
 * 接口：async get(key)→value | null, set(key, value, ttlSec?), del(key), scan(prefix)→string[]
 * value 为任意可 JSON 序列化对象（适配器自行处理序列化）。
 */

/** 内存 KV：Map + setTimeout TTL，直接存对象 */
export function memoryKv() {
  const store = new Map()
  const ttls = new Map()
  return {
    async get(k) {
      return store.has(k) ? store.get(k) : null
    },
    async set(k, v, ttlSec) {
      store.set(k, v)
      if (ttlSec && ttlSec > 0) {
        if (ttls.has(k)) clearTimeout(ttls.get(k))
        const t = setTimeout(() => { store.delete(k); ttls.delete(k) }, ttlSec * 1000)
        t.unref?.() // 不阻止进程退出
        ttls.set(k, t)
      }
    },
    async del(k) {
      store.delete(k)
      if (ttls.has(k)) { clearTimeout(ttls.get(k)); ttls.delete(k) }
    },
    async scan(prefix) {
      return [...store.keys()].filter((k) => k.startsWith(prefix))
    },
  }
}

/**
 * Redis KV：包装 Yunzai 的 global.redis（ioredis / node-redis 通用子集）。
 * 对象走 JSON；TTL 用 EX。
 */
export function redisKv(redis) {
  if (!redis) throw new Error('redisKv 需要 redis 实例')
  return {
    async get(k) {
      const v = await redis.get(k)
      if (v == null) return null
      try { return JSON.parse(v) } catch { return v }
    },
    async set(k, v, ttlSec) {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      if (ttlSec && ttlSec > 0) await redis.set(k, s, 'EX', ttlSec)
      else await redis.set(k, s)
    },
    async del(k) {
      await redis.del(k)
    },
    async scan(prefix) {
      if (typeof redis.keys === 'function') return redis.keys(`${prefix}*`)
      return []
    },
  }
}
