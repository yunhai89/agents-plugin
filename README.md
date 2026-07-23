<div align="center">

# 🤖 agents-plugin

**基于 [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai) / [Miao-Yunzai](https://github.com/Le-niao/Yunzai-Bot) 的全功能 AI Agent 插件**

一个插件打通：多模型对话 · 工具调用 · 长期记忆 · 人设 · 多模态识图 · MCP · 群管 · 终端 · 图片渲染

<img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License">
<img src="https://img.shields.io/badge/platform-TRSS%2FMiao--Yunzai-9cf" alt="Platform">
<img src="https://img.shields.io/badge/runtime-Node%20ESM-success" alt="Runtime">
<img src="https://img.shields.io/badge/AI-Agent-orange" alt="AI Agent">
<img src="https://img.shields.io/badge/QQ%E7%BE%A4-960179589-green" alt="QQ Group">

**QQ 群**：[960179589](https://qm.qq.com/q/960179589) ｜ **作者 QQ**：3891977697

</div>

---

> ## 🧪 功能状态提示
>
> **深度搜索、深度研究（`#研究`）目前处于早期开发阶段**，效果可能不稳定、质量参差，**甚至可能无法正常使用**。
> 这两项依赖联网检索 + 多轮子代理编排，受搜索源可用性、模型能力、token 消耗等影响较大，仍在持续打磨。
> 核心对话（多模型聊天 / 工具调用 / 记忆 / 人设 / 图片渲染 / MCP / 群管）是稳定可用的主力功能，请以核心对话为主，深度研究为辅。

---

## 📌 功能一览

| 能力 | 说明 | 状态 |
| --- | --- | --- |
| 💬 多模型对话 | OpenAI / Anthropic 双协议，接 DeepSeek / Kimi / MiMo / 通义 / 智谱 / Gemini 等 | ✅ 稳定 |
| 🖼️ 图片渲染回复 | markdown → 精美浅色图片（完整语法 + 代码高亮），失败退文本 | ✅ 稳定 |
| 🔧 工具调用 | ReAct 内核、并行调用、RBAC + 主人审批、工具开发 SDK | ✅ 稳定 |
| 🧠 长期记忆 | MEMORY.md/USER.md 人可编辑 + `memory_search` 主动召回（参考 OpenClaw） | ✅ 稳定 |
| 🎭 人设系统 | 内置 5 角色 + 自建，替换身份层不缩水工具/记忆 | ✅ 稳定 |
| 🖼️ 多模态识图 | 视觉子模型（主模型无视觉时图转文） | ✅ 稳定 |
| 🔌 MCP | 完整 MCP 客户端（stdio / HTTP）、多服务端、按工具 RBAC | ✅ 稳定 |
| 👥 群聊工具 | 群信息 / 群管理 / 米游社搜索 | ✅ 稳定 |
| 💻 终端执行 | shell 执行（allowlist 免审 + 黑名单 + 主人审批，默认关，**高危**） | ⚠️ 高危可选 |
| 🔍 统一搜索 | Tavily/Exa/Perplexity/Brave → SearXNG → DDG 兜底 | 🧪 早期 |
| 📚 深度研究 | `#研究` 五阶段管线（规划→检索→综合→引用→评估） | 🧪 早期 |

---

## 📑 目录

- [📦 安装](#-安装)
- [🚀 快速开始](#-快速开始)
- [⚙️ 详细配置](#️-详细配置pluginsagents-pluginconfigconfigyaml)
- [🎮 指令](#-指令)
- [🧩 自定义工具](#-自定义工具开发)
- [🎓 技能系统](#-技能系统skills)
- [🧠 记忆体系](#-记忆体系参考-openclaw文件即真相)
- [💻 终端执行 + 审批](#-终端执行--审批allowlist-自动放行)
- [🏗️ 架构](#️-架构)
- [🔧 日志](#-日志与排查)
- [📞 联系](#-联系)

---

## ⚠️ 安全声明

本插件提供**终端（shell）执行能力**，属于**高危工具**：

- shell 可在主机上执行**任意命令**——读写/删除文件、安装软件、访问网络、调用系统权限。
- 插件已做多层防护（仅主人可用、allowlist 只读命令免审、未知/写命令需主人 `#确认`、黑名单硬拦灾难性命令），**但任何防护都无法保证 100% 安全**——命令组合、解释器、环境差异等都可能绕过静态规则。
- **终端默认关闭**（`agent.terminal.enable` 默认 `false`），需在配置里**单独手动开启**。
- **开启 `agent.terminal.enable: true` 即表示你已知晓上述风险、同意自行承担一切后果，与开发者无关。** 开发者会尽量保证安全性，但不作任何担保。

> 如不接受该风险，请保持 `terminal.enable: false`（默认）。不启用终端时，本插件不涉及任何主机命令执行，无此风险。

---

## 📦 安装

```bash
git clone https://gitee.com/YunXi-67/agents-plugin.git ./plugins/agents-plugin
cd ./plugins/agents-plugin && npm install      # 安装 markdown 渲染依赖（marked / highlight.js）
```

> 除 markdown 渲染（marked / marked-highlight / highlight.js，需在插件目录 `npm install`）外，其余依赖随 Yunzai 提供。`#agents更新`（git pull）后若 package.json 有变动，需重跑一次 `npm install`。
> 重启 Yunzai 后，首次启动自动在**插件自己的** `plugins/agents-plugin/config/config.yaml` 生成配置，填入 API Key 即可使用。

### 🖼️ 图片回复（默认开启）

机器人回复**默认渲染成精美浅色图片**（完整 markdown + 代码语法高亮），渲染失败自动退文本。配置 `agent.reply.mode`：
- `image`（默认）：markdown → 浅色卡片图片（标题/列表/代码高亮/表格/引用全支持）
- `text`：纯文本回复

> 配置文件在插件目录内（不在 Yunzai 根）。若你之前用的是旧版 `Yunzai/config/agents-plugin.yaml`，首次加载会**自动迁移**到插件目录并删除旧文件（apiKey/masters 等全部保留）。
> **支持热加载**：改完配置保存即可，**无需重启 Yunzai**——下次对话自动用新配置重建运行时（provider/model/tools/skills/mcp）。也可发 `#agents重载`（主人）立即重建。
>
> **锅巴（Guoba）适配**：已支持。安装 [Guoba-Plugin](https://gitee.com/guoba-yunzai/guoba-plugin) 后，`#锅巴登录` 进入 Web 面板即可图形化编辑本插件配置；保存后**自动热加载**。适配文件为插件根 `guoba.support.js`。

---

## 🚀 快速开始

编辑 `plugins/agents-plugin/config/config.yaml`，最少只需填两项：

```yaml
agent:
  protocol: openai        # 或 anthropic
  preset: deepseek        # 厂商预设：openai/deepseek/gemini/dashscope/zhipu/moonshot/mimo（anthropic: anthropic/deepseek/mimo）
  apiKey: "sk-xxx"        # 你的 API Key
  model: "deepseek-chat"  # 模型 ID
```

群里 **@机器人** 或发 **`#ai 你好`** 即可对话。

---

## ⚙️ 详细配置（`plugins/agents-plugin/config/config.yaml`）

> 配置文件不含注释（保持整洁），所有字段含义在此说明。未用到的字段留空即可。

### 基础

| 字段 | 说明 |
| --- | --- |
| `debug` | `true` 打开详细日志（工具入参/每轮 token/搜索词等），排查时开启 |
| `prefix` | 命令前缀（保留备用） |

### `agent` —— 对话与模型

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `trigger` | `at` | 触发模式：`at`(艾特) / `command`(触发词) / `both` |
| `triggerCommand` | `#ai` | `trigger` 为 command/both 时的触发词 |
| `protocol` | `openai` | `openai` / `anthropic`（均支持各兼容端点） |
| `preset` | `deepseek` | 厂商预设（自动填 baseURL/headers/字段映射） |
| `baseURL` | 空 | 自定义 baseURL，覆盖 preset |
| `apiKey` | 空 | **必填** API Key |
| `model` | `deepseek-chat` | 模型 ID |
| `reasoningFields` | `[]` | 推理字段归一化（如 `["reasoning_content"]`），preset 通常已带 |
| `maxTurns` | `50` | 单次对话工具调用轮次预算 |
| `temperature` | 空 | 采样温度 |
| `maxTokens` | 空 | 单次回复最大 token（留空=厂商默认；Anthropic 默认 4096） |
| `contextWindow` | 空 | 模型上下文窗口 token 数（如 `32000`）；超 80% 自动压缩历史、保留首条意图 |
| `maxToolResultChars` | `4000` | 单条工具结果字符上限，超长截断防上下文膨胀 |
| `keepReasoning` | `false` | 是否把推理(`reasoning_content`)回灌历史；默认 `false` 省 context |
| `stream` | `false` | 逐字流式输出（依赖适配器、不稳，默认关） |
| `progress` | `true` | 工具调用时推送节流进度消息（消除"干等"，默认开） |
| `reply.mode` | `image` | 回复渲染：`image`（markdown→浅色图片，默认）/ `text`（纯文本） |
| `thinking` | 空 | 思考模式，如 `{ type: "enabled", budget_tokens: 16000 }` |
| `memoryLimits` | 空 | 声明式记忆字符上限，如 `{ memory: 2200, user: 1375 }` |
| `systemPrompt` | 空 | 默认身份 system prompt（留空用富默认身份；被人设覆盖时失效） |
| `chatPermission` | `master` | `#ai` 命令权限：`master`/`admin`/`owner`/`all` |
| `masters` | `[]` | 接收审批通知的 master QQ 号列表 |
| `masterSkipConfirm` | `false` | ⚠️高危：主人发起的确认类工具（terminal 写命令等）免 `#确认` 直接执行（仅主人，控制台有日志不在聊天提示；denylist 仍硬拦） |
| `confirmTimeout` | `300` | 审批超时自动拒绝（秒） |
| `guardAction` | `flag` | 注入防御动作：`block`(拦截)/`flag`(隔离标注)/`sanitize`(脱敏) |
| `guardSensitivity` | `medium` | 防御灵敏度：`low`(0.95)/`medium`(0.7)/`high`(0.5) |

### `agent.policy` —— RBAC 策略

```yaml
policy:
  categoryMin:
    message: 1        # 覆盖内置类别最低角色
    mcp_write: 2      # 自定义类别（如 MCP 写工具需群管以上）
```

内置类别阶梯：`query:0` / `personal:0` / `message:1` / `group_manage:2` / `system:3`。角色：`member<admin<owner<master(99)`。

### `agent.media` —— 多模态 / 文件

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enable` | `true` | 多模态总开关 |
| `active` | `true` | 主动收集（消息/引用/合并转发/群文件中的图片文件） |
| `passive` | `true` | 被动工具（`list_group_files`/`get_group_file`/`read_attachment`） |
| `maxImages` | `4` | 单次随消息发送最大图片数 |
| `maxFileBytes` | `8388608` | 单文件字节上限 |
| `degrade` | `note` | 非视觉模型降级：`skip`/`note`/`text` |
| `caps` | 空 | 覆盖模型能力判定（一般无需配置），如 `{ vision: true, file: true }` |

### `agent.vision` —— 视觉子模型

主模型不支持视觉时，由视觉子模型识图 → 文本描述 → 主模型回答。主模型支持视觉则直发原图、不走此路径。默认复用主模型 `protocol/baseURL/apiKey`，只换 `model`。

```yaml
vision:
  enable: true
  model: "mimo-2.5"     # 视觉模型 ID（必填才启用）
  # 以下可选：覆盖为独立厂商
  protocol:             # 如 anthropic
  preset:
  baseURL: ""
  apiKey: ""            # 空则复用主 apiKey
  maxTokens: 1024
  describePrompt: ""    # 自定义"描述这张图"指令
```

### `agent.tools` —— 工具 SDK

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `builtin` | `true` | 启用内置工具包（群信息/群管/米游社） |
| `dir` | `tools` | 自定义工具包目录（相对插件根，自动加载） |

### `agent.miyoushe` —— 米游社

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `cookie` | 空 | 可选，提升搜索成功率/看全文；不填可匿名搜索 |
| `defaultGid` | `2` | 默认游戏 gid（2原神/6星铁/8绝区零/1崩坏三/4未定/3崩坏学院2） |

### `agent.persona` —— 人设

```yaml
persona:
  dir: ""   # 自定义人设目录（默认 data/agents-plugin/personas）
```

### `agent.search` —— 统一搜索 🧪早期

> 🧪 搜索为早期功能，效果取决于搜索源可用性。任填一个 key 即用该源；都不填回退 SearXNG，再兜底 DDG（始终可用）。

```yaml
search:
  tavily:    { apiKey: "" }
  exa:       { apiKey: "" }
  perplexity: { apiKey: "" }
  brave:     { apiKey: "" }
  searxng:   { url: "" }     # 如 http://localhost:8080
  ddg: true                  # 本地 DDG 兜底（默认开）
```

### `agent.research` —— 深度研究 🧪早期

> 🧪 **深度研究处于早期开发，效果可能差或不可用**（见顶部「功能状态提示」）。受搜索源、模型能力、token 消耗影响大，仅作辅助。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `permission` | `master` | `master`（防 token 滥用）/ `all` |
| `maxRounds` | `3` | 外层 Supervisor 最大轮次 |
| `maxConcurrent` | `3` | 子代理并发上限 |
| `workerModel` | 空 | 子代理模型（空则用主模型；省钱可填便宜模型） |
| `evaluation` | `true` | 是否跑五维评估 |

### `agent.mcp` —— MCP 服务端

```yaml
mcp:
  requestTimeout: 60000
  servers:
    fs:                           # stdio 子进程示例
      command: "npx"
      args: ["-y", "@modelcontextprotocol/server-filesystem", "./"]
      prefix: "fs"
      category: "query"           # 字符串：该服务端所有工具同类；或按工具映射 { read_file: "query", write_file: "system", default: "query" }
    remote:                       # HTTP 远程示例
      transport: "http"
      url: "https://example.com/mcp"
      headers: { Authorization: "Bearer ..." }
      listen: false
      prefix: "rmt"
      enabled: true
```

> **⚠️ Docker / 精简镜像没有 `npx`？—— MCP 握手超时（ENOENT）**
>
> 部分 Yunzai Docker 镜像只装了 `node`、**没有 `npm`/`npx`/`corepack`**（某些 `trss`/`miao` 镜像即如此）。此时上面 `command: "npx"` 会启动失败：
> ```
> [mcp] xxx 连接失败：传输关闭（进程退出码-2；spawn 失败：ENOENT spawn npx（npx 不在 PATH？…））
> ```
> （旧版本这种情况只甩一句看不懂的 `request timeout: initialize`；现已**立即**报出 ENOENT + 退出码 + stderr 末尾，便于定位。）
>
> **判断**：`docker exec <容器> command -v npx` —— 输出为空就是容器里没装 npx。
>
> **解决方案（任选其一，推荐 ①）**：
>
> 1. **给容器补上 npm/npx（一次性脚本，推荐）**：仓库自带 [`scripts/bootstrap-npm-docker.sh`](scripts/bootstrap-npm-docker.sh)，纯 `node + curl + tar` 实现、不依赖包管理器：
>    ```bash
>    docker cp plugins/agents-plugin/scripts/bootstrap-npm-docker.sh <容器>:/tmp/bs.sh
>    docker exec <容器> sh /tmp/bs.sh
>    # 装好后 npx 进入容器 PATH，上面 MCP 配置无需任何改动
>    ```
>    ⚠️ 脚本装在「运行中的容器」里，**容器一旦重建（重新 `docker run`）会丢失**，需重跑；想一劳永逸请把它加进镜像 entrypoint / Dockerfile。
> 2. **改用绝对路径**：若容器别处有 `npx`/`node`，把 `command` 换成绝对路径（如 `/usr/local/bin/npx`）。
> 3. **绕开 npx**：容器内 `npm i -g <mcp包>` 全局安装后，用 `command: "/usr/bin/node"` + `args: ["<全局模块入口 js 的绝对路径>"]` 直接跑；或改用 `transport: "http"` 连远程 MCP，本地无需任何进程。

---

## 🎮 指令

### 对话
| 指令 | 说明 |
| --- | --- |
| `@机器人 +内容` | 艾特对话（默认触发） |
| `#ai +内容` | 自定义触发词（`trigger=command/both`） |
| `#聊天列表` | 查看所有对话（图片） |
| `#进入聊天 +id` | 切换对话 |
| `#new` | 新建对话 |

### 人设
| 指令 | 说明 |
| --- | --- |
| `#人设` / `#人设列表` | 查看人设列表（图片） |
| `#人设 +id` | 切换人设 |
| `#人设详情 +id` | 查看人设内容 |
| `#新建人设 +名称 +内容` | 创建自定义人设并切换 |
| `#删除人设 +id` | 删除（仅创建者/master） |
| `#重置人设` | 恢复默认 |

### 深度研究 🧪
| 指令 | 说明 |
| --- | --- |
| `#研究 +主题` | 🧪 **早期功能**：深度研究（结果 PDF→高清图→文本），效果可能不稳定 |

### 记忆 / 提醒
| 指令 | 说明 |
| --- | --- |
| `#记忆` | 查看长期记忆 |
| `#忘掉 +关键词` | 按关键词遗忘 |
| `#我的提醒` / `#取消提醒 +id` | 提醒管理 |
| `#清空所有记录` | 清空**自己**的对话历史/记忆/笔记/提醒/人设绑定（不含配置；2 步确认） |

### 主人指令
| 指令 | 说明 |
| --- | --- |
| `#模型切换 +id` | 切换 LLM 模型 |
| `#启用mcp +名` / `#停止mcp +名` | MCP 服务端启停 |
| `#添加mcp +JSON` | 按标准 `mcpServers` JSON 添加 MCP（连接验证+持久化），如 `{ "mcpServers": { "zai": { "type":"stdio", "command":"npx", "args":[...], "env":{...} } } }` |
| `#mcp` | MCP 连接状态 |
| `#确认 +id` / `#拒绝 +id` / `#待确认` | 审批待执行危险动作 |
| `#agents帮助` / `#agents状态` | 帮助图 / 运行状态 |
| `#agents重载` | 热重载配置并立即重建运行时（model/tools/skills/mcp，无需重启框架） |
| `#agents更新` / `#agents强制更新` | git pull 拉取最新代码（强制=reset 后 rebase），有代码改动时自动重启 Yunzai 生效 |
| `#agents版本` / `#agents更新日志` | 最近提交时间 / 本次更新日志 |

---

## 🧩 自定义工具开发

在插件根 `tools/` 目录新建 `.js`，自动加载（TRSS-Yunzai apps 风格）：

```js
import { defineToolPack, defineTool, param, getGroup, ok } from '../model/toolkit/index.js'

export default defineToolPack({
  name: 'my',
  description: '我的工具包',
  tools: [
    defineTool({
      name: 'echo_group',
      description: '返回当前群名',
      category: 'query',                 // query/personal/message/group_manage/system
      parameters: param.object({}),
      async execute(p, ctx) {
        const g = getGroup(ctx)
        return g ? ok('当前群：' + (await g.getInfo?.())?.group_name) : ok('非群聊')
      },
    }),
  ],
})
```

`tools/example.js` 是带完整注释的模板。`category` 决定 RBAC 权限门槛。

---

## 🎓 技能系统（Skills）

**技能 = 渐进式披露的"说明书"**（参考 OpenClaw AgentSkills 规范）。与工具（Tool，能力本身、模型直接调用）不同，技能是一段 `SKILL.md` 指令，教模型"什么场景用哪些工具、按什么顺序、有什么约束"。它**不新增动作**，只增强决策。

**模型如何"主动调用"技能**（解决"AI 不调用 skill"）：

1. **目录始终可见**：所有技能的 `name`+`description` 编译成精简 `<available_skills>` 块，每轮注入 system prompt。模型由此**知道有哪些技能、各自适用什么场景**。
2. **按需加载正文**：任务匹配某技能描述时，模型调用内置 `skill` 工具按名称加载其完整说明并遵循——这就是"主动调用技能"的通道。
3. **兼容抢先注入**：`always: true` 正文常驻；`when` 关键词/正则命中时正文额外自动注入（向后兼容）。

### 编写一个技能

在插件根 `skills/` 目录新建 `my-skill.md`（自动加载，免重启可用 `reload_skills` 工具热加载）：

```markdown
---
name: my-skill
description: "一句话说清何时用：名词短语，是模型决定是否加载的唯一依据"
when: [关键词1, 关键词2]   # 可选：命中时抢先注入正文（向后兼容）
priority: 5               # 可选：目录/注入排序
always: false             # 可选：true 则正文常驻
---

# 技能正文

这里写完整的操作指引：用什么工具、按什么顺序、有哪些约束与最佳实践。
正文只在被加载后（目录命中描述→调用 skill 工具，或 when 命中）注入，所以可以写得详细。
可引用【自我状态】等 perception 注入的数据。
```

要点：
- **`description` 是关键**——它是目录里模型唯一的判定依据，写成"何时用"的名词短语，别写成长篇流程。
- 正文放决策约束与步骤，别只写"让用户去发某指令"。
- 技能不是工具：没有 `execute`，不能被直接执行，只能被加载为指令。

内置技能示例：`skills/group-admin.md`（群管）、`skills/deep-research.md`（深度研究）、`skills/capability-inquiry.md`（能力询问）、`skills/skillhub-install.md`（技能商店安装）。

---

## 🧠 记忆体系（参考 OpenClaw「文件即真相」）

两层记忆，互补：

- **声明式记忆（`MEMORY.md` / `USER.md`）**：Agent 的个人笔记 / 用户画像，**Markdown 文件、人可读可编辑**（位于 `Yunzai/data/agents-plugin/memories/`）。每条一行 `- ` bullet，有字符预算（memory 2200 / user 1375）。模型用 `memory` 工具 add/replace/remove 维护，自动注入 system prompt。旧版 `memory.json`/`user.json` 首次加载自动迁移为 `.md`。可直接编辑文件，重启后生效。
- **召回式记忆（`memory_search` 工具）**：跨会话的长期记忆（偏好/身份/事实/近期事项），相似度×时间衰减召回。**模型主动检索**——回答涉及用户先前说过的偏好、历史决策、待办前，先调 `memory_search(query)` 核实，不要凭印象作答（移植 OpenClaw "Mandatory recall step" 语义）。结果带类型与日期引用。

指令：`#记忆` 查看、`#忘掉 <关键词>` 遗忘。

---

## 💻 终端执行 + 审批（allowlist 自动放行）

> **⚠️ 高危**：见上方「安全声明」。`terminal` 默认关闭，需 `agent.terminal.enable: true` **单独开启**；开启即视为你知晓风险并自担后果。

`terminal` 工具让 Agent 在主机执行 shell 命令。安全是纵深防御（参考 OpenClaw）：

- **allowlist 自动放行**：只读安全命令（`ls`/`cat`/`grep`/`git status`/`npm list`/`node --version` 等，见 `terminal.allowlist`）**免审批直接执行**；含重定向(`>`)/命令替换/写操作的命令不自动放行。
- **审批门**：未知命令 / 写操作 → 主人收到 DM（含命令预览 + 风险提示：⚠️写入/🌐网络/🔐提权/📦安装），`#确认 <id>` / `#拒绝 <id>`，超时自拒。每次动作一次性审批。
- **黑名单**：灾难性命令（`rm -rf /` / `mkfs` / `dd of=/dev/` / 关机重启 等）即使已确认也硬拦。
- 仅主人可用；`terminal.allowlist` 非空则替换默认只读集，`terminal.blocklist` 追加禁令。

---

## 🏗️ 架构

```
apps/        事件分发与回复编排（agent 对话 / research 研究 / help / render）
model/
  ├─ render                 统一浅色主题 + markdown→图片渲染（marked/highlight.js）
  ├─ openai · anthropic      协议传输层（流式/重试/熔断/failover）
  ├─ llm                     模型能力注册表 + 熔断器 + 连接池 + embedding
  ├─ agent                   ReAct 内核 + 工具/会话/记忆/防护/策略/审批
  ├─ prompt                  分层 system prompt 构建（执行取向/工具目录/技能/安全）
  ├─ evolution               GEPA 提示词自我进化引擎
  ├─ mcp                     Model Context Protocol 客户端（多服务端）
  ├─ multiagent              编排器-工人 / pipeline / parallel / router
  ├─ search · tavily         统一搜索（多源路由 + DDG 兜底）
  ├─ research                深度研究五阶段管线 + 报告渲染
  ├─ media                   多模态文件收集/解析/协议转换
  ├─ vision                  视觉子模型识图
  ├─ miyoushe                米游社帖子搜索
  ├─ group                   群信息 + 群管理工具
  ├─ persona                 人设库 + 激活绑定
  └─ toolkit                 工具开发 SDK + 自动加载器
tools/       自定义工具包（自动加载）
skills/      技能说明书（SKILL.md，自动加载）
utils/       Config 配置读写（插件目录 + 热加载） · Log 分级日志
```

每个 `model/*` 模块均有离线自检（`node model/<模块>/test.mjs`），合计 **960+ 断言全绿**。

---

## 🔧 日志与排查

分级日志（`utils/Log.js`）：`mark`（里程碑）/ `info`（研究进度）/ `debug`（工具入参·每轮 token）/ `warn` / `error`。开启 `debug: true` 可看到 AI 每次调用工具的名称、入参、结果与每轮 token 用量，深度研究的迭代轮次与搜索词，便于排查。

**MCP 连不上时先看报错措辞**：`request timeout: initialize` = 服务端进程起来了但没在超时内响应握手（npx 首次下载慢 / 网络不通 / 命令错误）；`ENOENT spawn npx` / `进程退出码-2` = 容器里压根没有 npx（精简 Docker 镜像常见）—— 解决方案见上文 `agent.mcp` 章节的 ⚠️ 说明；`进程退出码 N` + stderr = 服务端启动即崩溃（缺 API Key / 依赖 / Node 版本，看 stderr 末尾）。

---

## 📞 联系

- **QQ 群**：[960179589](https://qm.qq.com/q/960179589)
- **作者 QQ**：3891977697

问题反馈、功能建议、工具包分享欢迎进群交流。

## 许可证

[GPL-3.0](./LICENSE)
