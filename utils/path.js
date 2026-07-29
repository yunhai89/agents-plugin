/** 点路径工具（web 路由与 guoba 共用，避免重复实现） */

/** 按点路径写入嵌套对象：setPath(cfg, 'agent.model', 'x')；中间节点不存在自动建 {} */
export function setPath(obj, p, value) {
  const keys = String(p).split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
    cur = cur[k]
  }
  cur[keys[keys.length - 1]] = value
}

/** 按点路径读取：getPath(cfg, 'agent.model') → 值或 undefined */
export function getPath(obj, p) {
  let cur = obj
  for (const k of String(p).split('.')) {
    if (cur == null) return undefined
    cur = cur[k]
  }
  return cur
}
