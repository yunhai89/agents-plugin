/** Deep Research 公共出口 */
export { DeepResearch } from './deep-research.js'
export { ResearchState, routeStrategy, EFFORT_CONFIG, scoreSourceQuality, isHighQualitySource, isLowQualitySource } from './state.js'
export { evaluateReport, quickCheck, parseJudgeResult } from './evaluation.js'
export { buildResearchHtml, markdownToHtml, safeFilename, splitMessage } from './render.js'
