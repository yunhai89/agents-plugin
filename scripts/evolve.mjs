#!/usr/bin/env node
/**
 * 离线进化 CLI —— 对应 hermes `python -m evolution.skills.evolve_skill`。
 *
 * 用法（在 Yunzai 根目录或插件目录运行；需配置 config/agents-plugin.yaml 的 agent 段）：
 *   node scripts/evolve.mjs --name weather-bot --baseline @prompt.txt \
 *       --cases cases.json --iterations 10 --out reports/weather-bot
 *   # 或合成评估用例：
 *   node scripts/evolve.mjs --name weather-bot --baseline @prompt.txt --synthetic "天气查询" --n 8
 *
 * 产物 reports/<name>/{evolved.md, report.md, state.json}，请人工审查后采纳。
 */
import fs from 'node:fs'
import path from 'node:path'

import Config from '../utils/Config.js'
import Log from '../utils/Log.js'
import { Agent, createProvider, ToolRegistry } from '../model/agent/index.js'
import { presets as openaiPresets } from '../model/openai/index.js'
import { presets as anthropicPresets } from '../model/anthropic/index.js'
import { evolve, writeReport, createLlmJudge, makeCase, synthetic } from '../model/evolution/index.js'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = argv[i + 1]
    if (k.startsWith('--')) {
      out[k.slice(2)] = v && !v.startsWith('--') ? v : true
      if (out[k.slice(2)] !== true) i++
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const name = args.name
  if (!name) throw new Error('缺少 --name')
  if (!args.baseline) throw new Error('缺少 --baseline（文本或 @文件路径）')
  if (!args.cases && !args.synthetic) throw new Error('需要 --cases <file.json> 或 --synthetic "<goal>"')

  const cfg = Config.get().agent || {}
  if (!cfg.apiKey) throw new Error('未配置 agent.apiKey（编辑 config/agents-plugin.yaml）')

  // provider + agents
  const protocol = cfg.protocol || 'openai'
  const presets = protocol === 'anthropic' ? anthropicPresets : openaiPresets
  const preset = cfg.preset ? presets[cfg.preset] : {}
  const provider = createProvider({
    protocol,
    ...preset,
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    apiKey: cfg.apiKey,
    model: cfg.model,
  })
  const tools = new ToolRegistry() // 按需注册工具
  const newAgent = (extra) => new Agent({ provider, model: cfg.model, tools, logger: (...a) => Log.debug('[evolve]', ...a), ...extra })

  // baseline 文本
  let baseline = args.baseline
  if (baseline.startsWith('@')) baseline = fs.readFileSync(path.resolve(baseline.slice(1)), 'utf8')

  // 数据集
  let dataset
  if (args.cases) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(args.cases), 'utf8'))
    dataset = raw.map((c) => makeCase(c))
  } else {
    dataset = await synthetic({ goal: args.synthetic, n: Number(args.n) || 8, agent: newAgent() })
  }
  if (!dataset.length) throw new Error('数据集为空')

  const result = await evolve({
    target: { type: args.target || 'systemPrompt', name, text: baseline, goal: args.goal || `优化 ${name}` },
    dataset,
    agentFactory: (prompt) => newAgent({ systemPrompt: prompt }),
    judge: createLlmJudge(newAgent()),
    agent: newAgent(), // 变异器
    iterations: Number(args.iterations) || 10,
    populationSize: Number(args.population) || 8,
    seed: Number(args.seed) || 42,
    logger: (...a) => Log.info('[evolve]', ...a),
  })

  const out = args.out || path.join('reports', name)
  writeReport(result, out)
  Log.info(`完成：improved=${result.improved} best=${result.best.score.toFixed(3)}（baseline ${result.baseline.score.toFixed(3)}）→ ${out}/evolved.md`)
}

main().catch((e) => {
  Log.error('[evolve]', e?.message || e)
  process.exit(1)
})
