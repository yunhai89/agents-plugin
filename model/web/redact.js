/**
 * 配置出口处理。
 *
 * 自用面板：所有字段（含 apiKey / baseURL / proxy / cookie / refreshToken / masters /
 * mcp.servers.*.env·headers / stt.apiKey 等）一律明文返回，便于在 web 面板直接查看与编辑。
 * 用户明确选择「全部不脱敏」，接受浏览器残留 / 截图泄露风险；非密钥托管场景。
 *
 * 故 redactConfig 仅做深拷贝（绝不修改原 Config），不再做任何脱敏。
 * 保留函数名以维持 GET /api/config 调用链不变。
 */
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)))

/** 入口：深拷贝 agent 配置，原样明文返回。 */
export function redactConfig(agentCfg) {
  return clone(agentCfg)
}
