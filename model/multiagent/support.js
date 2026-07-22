/**
 * Semaphore —— 并发限流，防 multi-agent 扇出失控（文档 §6.3 成本控制）。
 */
export class Semaphore {
  constructor(max = 3) {
    this.max = max
    this._active = 0
    this._queue = []
  }
  async acquire() {
    if (this._active < this.max) {
      this._active++
      return
    }
    await new Promise((resolve) => this._queue.push(resolve))
  }
  release() {
    if (this._queue.length > 0) {
      this._queue.shift()() // 直接传递槽位，active 不变
    } else {
      this._active--
    }
  }
  get active() { return this._active }
  get waiting() { return this._queue.length }
}

/**
 * Trace —— 观测事件流（文档 §6.5：没有 tracing 的 multi-agent 等于裸奔）。
 */
export class Trace {
  constructor() { this._events = [] }
  emit(type, data = {}) { this._events.push({ type, data, ts: Date.now() }) }
  get events() { return [...this._events] }
  filter(type) { return this._events.filter((e) => e.type === type) }
  clear() { this._events = [] }
}

/**
 * SharedState —— 黑板/状态传递（文档 §3.1：跨 step 共享数据，非可变全局）。
 */
export class SharedState {
  constructor(initial = {}) { this._data = { ...initial } }
  get(key) { return this._data[key] }
  set(key, value) { this._data[key] = value; return value }
  update(patch) { Object.assign(this._data, patch) }
  delete(key) { delete this._data[key] }
  toJSON() { return { ...this._data } }
  get keys() { return Object.keys(this._data) }
}
