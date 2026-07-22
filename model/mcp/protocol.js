/**
 * MCP 协议常量（方法名 / 协议版本 / 能力位 / 内容类型）。
 * 规范：https://modelcontextprotocol.io  （本库为客户端实现）
 */

export const PROTOCOL_VERSION = '2025-06-18'

export const METHODS = {
  // lifecycle
  INITIALIZE: 'initialize',
  INITIALIZED: 'notifications/initialized',
  PING: 'ping',
  SHUTDOWN: 'shutdown',
  // tools
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
  TOOLS_LIST_CHANGED: 'notifications/tools/list_changed',
  // resources
  RESOURCES_LIST: 'resources/list',
  RESOURCES_READ: 'resources/read',
  RESOURCES_LIST_CHANGED: 'notifications/resources/list_changed',
  RESOURCES_SUBSCRIBE: 'resources/subscribe',
  RESOURCES_UNSUBSCRIBE: 'resources/unsubscribe',
  RESOURCES_UPDATED: 'notifications/resources/updated',
  // prompts
  PROMPTS_LIST: 'prompts/list',
  PROMPTS_GET: 'prompts/get',
  PROMPTS_LIST_CHANGED: 'notifications/prompts/list_changed',
  // logging
  LOGGING_SET_LEVEL: 'logging/setLevel',
  LOGGING_MESSAGE: 'notifications/message',
  // server → client
  SAMPLING_CREATE: 'sampling/createMessage',
  ROOTS_LIST: 'roots/list',
  ELICITATION_CREATE: 'elicitation/create',
  PROGRESS: 'notifications/progress',
}

/** 内容块类型 */
export const CONTENT = {
  TEXT: 'text',
  IMAGE: 'image',
  AUDIO: 'audio',
  RESOURCE: 'resource',
}

export const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency']
