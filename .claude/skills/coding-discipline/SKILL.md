---
name: coding-discipline
description: 为本插件（agents-plugin）编写或修改代码、排查 bug、新增功能时强制遵守的工程规范——追深层调用链到叶子根因、搜索考虑嵌套结构、随功能同步建立可观测日志、新增配置字段保证用户可见、下结论前自检。每次开始编码或排查问题前先参考本规范并贯穿执行。
---

# 编码与排查规范（agents-plugin）

> 本技能沉淀自实际协作教训。**每次为本插件写代码或排查问题前，先读完本规范并贯穿执行，不要让用户重复指出同样的问题。**

## 1. 排查 / 读代码：追深层调用链到叶子

- 用户点名 A，**绝不只看 A**。沿调用链追 A→B→C→D 直到**叶子根因**；带深度上限（约 5 层），超限仍未到叶子才停止。
- 同时沿串联标识往回追前因：`traceId` / 调用栈 / 引用链 / import ——「日志里记了 A，那 A 之前有没有 B？B 之前有没有 C？」
- 用**并行工具一次性拉全**相关文件再综合判断，不要看一个、下一个。
- **严禁在「看起来正常」的中间层停下**就下结论。
  - 反例：txt→pdf 案例，只看 media 日志以为「文件下载正常没问题」；真正根因在 `model/media/convert.js` 的 `buildUserContent` 把附件正文塞进 input 时丢了文件名——必须追到 `fileToText` 才看得见。

## 2. 搜索要考虑嵌套结构

- `grep "^pixiv:"` 只匹配**顶层**，会漏嵌套的 `agent.pixiv`。
- 搜配置 / 字段 / 定义时，用递归或结构化对比（如把 yaml 解析后递归 diff），并**追到实际代码的读取路径**验证，别靠正则顶层想当然。

## 3. 写功能时同步建立可观测（devLog 规范）

功能改完，确保日志能**自证根因**，不依赖读代码。本插件用 `utils/DevLog.js`（pino 写 `data/logs/dev.*.log`），全链路用 `traceId` 串联。每次新增/改动功能，检查是否记录了：

- **意图**：用户输入原文（如 `trigger.text`）
- **结果**：最终输出正文（如 `reply.body`）
- **关键中间态**：实际喂给下游的输入 + 能力上下文（如 `input` 事件的 `inputText` / `caps` / 附件清单）
- **串联标识**：traceId 贯穿 trigger → input → turn → tool → run_end → reply，能按 id 追完整条链路
- **能自证的字段**：如文件 `size`(协议报告) vs `bytes`(实际下载) 对比判断下载完整性；`status` 给出 `ok` / `no_url` / `download_failed` / 失败原因
- **失败 / 降级路径**也要记，不只记成功路径

## 4. 新增配置字段要保证用户可见

- 在 `config/default_config/config.yaml` 加字段后，用户的 `config/config.yaml`（程序生成、无注释）**不会自动同步**。
- 必须经 `utils/Config.js` 的 `load()` 自愈机制（`hasMissingKeys` → `writeUser`）把缺失键补全回用户 config，让用户**编辑时看得到**新字段，而不是只靠运行时 `deepMerge` 兜底（那样字段既不可见也不可编辑）。
- 改默认值时注意：`config.yaml` 里的 `null` 会覆盖默认值（`deepMerge` 中 null 视为有效覆盖），改默认须同步检查用户 config。

## 5. 下结论 / 提交前自检清单

每次给出根因结论或提交代码前，逐条自检：

- [ ] 结论追到**叶子**了吗？还是停在某个「看起来正常」的中间层？
- [ ] 搜索是否漏了**嵌套**结构？
- [ ] 这个改动是否**同步建立了观测**（日志能自证根因）？
- [ ] 新增配置字段是否**对用户可见**（config 自愈）？
- [ ] 改动是否做了**语法检查**、是否**同步到部署版**？

## 附：本插件关键约定

- **部署位置**：容器 `TRSS_AllBot` 挂载 `/root/TRSS_AllBot/TRSS-Yunzai/plugins/agents-plugin/`；源仓库在 `/root/agents-plugin`。改代码后需 cp 同步到部署版，Yunzai 热加载。
- **config.yaml 是 gitignore 的**、按环境独立；源仓库改 config 不会同步到部署版，必须改部署版那份。
- **代码改动等用户说「提交」再 commit+push**（默认 master）；纯文档/注释可直接提交。
