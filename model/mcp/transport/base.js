/**
 * 传输接口 —— stdio / http（及将来的 SSE）实现的统一契约。
 *
 *   start():Promise        开始读
 *   send(obj):Promise      写一条 JSON-RPC 消息
 *   close():Promise        关闭
 *   onMessage(fn)          收到一条消息（已解析对象）
 *   onError(fn)            传输层错误
 *   onClose(fn)            连接/进程关闭
 *   onLog(fn)              非协议日志（如子进程 stderr）
 */
export class BaseTransport {
  constructor() {
    this._onMessage = () => {}
    this._onError = () => {}
    this._onClose = () => {}
    this._onLog = () => {}
  }
  set onMessage(fn) { this._onMessage = fn || (() => {}) }
  set onError(fn) { this._onError = fn || (() => {}) }
  set onClose(fn) { this._onClose = fn || (() => {}) }
  set onLog(fn) { this._onLog = fn || (() => {}) }

  async start() { throw new Error('start 未实现') }
  async send(/* obj */) { throw new Error('send 未实现') }
  async close() { throw new Error('close 未实现') }
}
