/** 视图:配置中心(§1 全量配置项,可编辑 mock) */
(function () {
  window.VIEWS = window.VIEWS || {}

  /* 行容器:左名称/说明,右控件 */
  const CfgRow = {
    name: 'CfgRow',
    props: { name: String, desc: { type: String, default: '' }, danger: Boolean },
    template: `
    <div class="cfg-item" :style="danger ? {borderColor:'#f3c8d1', background:'linear-gradient(180deg,#fff,#fff8f9)'} : {}">
      <div class="info">
        <div class="name">{{ name }}<span v-if="danger" class="chip chip-rose" style="margin-left:7px;font-size:10px;padding:2px 7px">高危</span></div>
        <div class="desc" v-if="desc">{{ desc }}</div>
      </div>
      <div class="ctl"><slot/></div>
    </div>`,
  }

  /* 标签编辑器 */
  const TagEditor = {
    name: 'TagEditor',
    props: { modelValue: { type: Array, required: true }, placeholder: { type: String, default: '回车添加' } },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      const input = Vue.ref('')
      const add = () => {
        const v = input.value.trim()
        if (v && !props.modelValue.includes(v)) emit('update:modelValue', [...props.modelValue, v])
        input.value = ''
      }
      const del = (i) => emit('update:modelValue', props.modelValue.filter((_, j) => j !== i))
      return { input, add, del }
    },
    template: `
    <div class="flex gap6 wrap" style="justify-content:flex-end">
      <span v-for="(t, i) in modelValue" :key="t" class="chip chip-primary" style="cursor:default">
        {{ t }}<v-icon name="x" style="cursor:pointer" @click="del(i)"/>
      </span>
      <input v-model="input" class="input" style="width:110px;padding:4px 9px;font-size:12px" :placeholder="placeholder" @keydown.enter.prevent="add">
    </div>`,
  }

  const OPT = {
    trigger: [['at', '@机器人触发'], ['command', '触发词触发'], ['both', '两者皆可']],
    protocol: [['openai', 'OpenAI 兼容'], ['anthropic', 'Anthropic 兼容'], ['gemini', 'Gemini 原生(官方SDK)']],
    preset: [['deepseek', 'DeepSeek'], ['openai', 'OpenAI'], ['gemini', 'Gemini'], ['dashscope', '通义(DashScope)'], ['zhipu', '智谱'], ['moonshot', 'Kimi(Moonshot)'], ['mimo', '小米(MiMo)'], ['anthropic', 'Anthropic'], ['openrouter', 'OpenRouter(聚合)']],
    permission: [['master', '仅主人'], ['admin', '管理员'], ['owner', '群主'], ['all', '所有人']],
    guardAction: [['block', '拦截(block)'], ['flag', '隔离标注(flag)'], ['sanitize', '脱敏(sanitize)']],
    guardSensitivity: [['low', '低 (0.95)'], ['medium', '中 (0.7)'], ['high', '高 (0.5)']],
    reflect: [['off', '关闭'], ['auto', '自动'], ['always', '总是']],
    replyMode: [['image', '图片渲染'], ['text', '纯文本']],
    termNet: [['none', 'none 无网(推荐)'], ['auto', 'auto 按需开网'], ['host', 'host 始终有网']],
    degrade: [['describe', 'describe 转文字描述'], ['ignore', 'ignore 忽略']],
    researchPerm: [['master', '仅主人(防滥用)'], ['all', '所有人']],
  }

  window.VIEWS.config = {
    name: 'ConfigView',
    components: { CfgRow, TagEditor },
    setup() {
      const { ref, reactive, watch, computed, onMounted, onUnmounted, nextTick } = Vue
      const { toast } = window.UI
      const M = window.MOCK

      /* 表单初始空,onMounted loadConfig 后填充;origSnapshot 用于 diff 与 reset */
      const form = reactive({})
      let origSnapshot = {}
      const dirty = ref(false)
      let dirtySuppressed = true
      watch(form, () => { if (!dirtySuppressed) dirty.value = true }, { deep: true })

      /* 同步 form 与快照(不触发 dirty) */
      const syncForm = (snap) => {
        dirtySuppressed = true
        Object.assign(form, snap)
        origSnapshot = JSON.parse(JSON.stringify(snap))
        mcpServersToUi()
        dirty.value = false
        nextTick(() => { dirtySuppressed = false })
      }

      /* 点路径 diff:全部字段明文,对象递归、数组/标量整体比较;MCP servers 整体提交(增删改不递归,避免删 server 漏掉) */
      const buildChanges = (orig, frm, prefix = 'agent', out = {}) => {
        for (const k of Object.keys(frm)) {
          const p = prefix + '.' + k, a = orig?.[k], b = frm[k]
          if (p === 'agent.mcp.servers') {
            if (JSON.stringify(a) !== JSON.stringify(b)) out[p] = b
            continue
          }
          if (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object') buildChanges(a, b, p, out)
          else if (JSON.stringify(a) !== JSON.stringify(b)) out[p] = b
        }
        return out
      }

      const save = async () => {
        mcpServersFromUi()
        const changes = buildChanges(origSnapshot, JSON.parse(JSON.stringify(form)))
        if (!Object.keys(changes).length) { toast('无改动', 'warn'); return }
        try {
          await window.api.put('/config', { changes })
          await window.store.loadConfig()
          if (M.config) syncForm(JSON.parse(JSON.stringify(M.config)))
          toast('已保存(已热加载)', 'success')
        } catch (e) { toast(e.message, 'error') }
      }
      const reset = () => {
        dirtySuppressed = true
        Object.assign(form, JSON.parse(JSON.stringify(origSnapshot)))
        dirty.value = false
        nextTick(() => { dirtySuppressed = false })
        toast('已还原为当前生效配置', 'info')
      }

      /* 分区折叠 */
      const sections = [
        { id: 'basic', name: '基础 / 模型', icon: 'cpu', grad: 'var(--grad-primary)' },
        { id: 'reason', name: '推理参数', icon: 'zap', grad: 'var(--grad-sky)' },
        { id: 'reply', name: '进度 / 回复渲染', icon: 'send', grad: 'var(--grad-teal)' },
        { id: 'memory', name: '记忆系统', icon: 'memory', grad: 'var(--grad-amber)' },
        { id: 'evolution', name: '自进化', icon: 'evolution', grad: 'var(--grad-rose)' },
        { id: 'security', name: '权限 / 安全 / 日志', icon: 'shield', grad: 'var(--grad-primary)' },
        { id: 'mcp', name: 'MCP 服务', icon: 'tool', grad: 'var(--grad-teal)' },
        { id: 'ext', name: '多模态 / 工具 / 扩展', icon: 'tool', grad: 'var(--grad-sky)' },
      ]
      // 仅「基础/模型」默认展开，其余收起（配置多时便于查找）
      const open = reactive(Object.fromEntries(sections.map((s) => [s.id, s.id === 'basic'])))
      const activeSec = ref('basic')
      const jump = (id) => {
        open[id] = true
        activeSec.value = id
        document.getElementById('cfg-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      /* 滚动高亮锚点 */
      const onScroll = () => {
        for (const s of sections) {
          const el = document.getElementById('cfg-' + s.id)
          if (el && el.getBoundingClientRect().top > 60 && el.getBoundingClientRect().top < 240) { activeSec.value = s.id; break }
        }
      }
      onMounted(async () => {
        window.addEventListener('scroll', onScroll, { passive: true })
        try {
          await window.store.loadConfig()
          if (M.config) syncForm(JSON.parse(JSON.stringify(M.config)))
        } catch (e) { toast(e.message, 'error') }
      })
      onUnmounted(() => window.removeEventListener('scroll', onScroll))

      /* 回退模型列表(baseURL/apiKey 明文) */
      const addFallback = () => form.fallbackModels.push({ model: '', baseURL: '', apiKey: '', protocol: 'openai' })
      const delFallback = (i) => form.fallbackModels.splice(i, 1)

      /* masters(明文 QQ 数组) */
      const masterInput = ref('')
      const addMaster = () => {
        const v = masterInput.value.trim()
        if (/^\d{5,11}$/.test(v)) {
          if (!form.masters.includes(v)) form.masters.push(v)
          masterInput.value = ''
        } else toast('QQ 号格式不正确', 'warn')
      }
      const delMaster = (i) => form.masters.splice(i, 1)

      /* MCP servers：对象 map 与 UI 文本双向(env/headers 对象 ↔ textarea 文本)。全部明文。
         loadConfig/reset 后 toUi 生成 _type/_envText/_headersText；save 前 fromUi 解析回并删除临时字段。 */
      const mcpServersToUi = () => {
        if (!form.mcp) form.mcp = {}
        const servers = form.mcp.servers && typeof form.mcp.servers === 'object' ? form.mcp.servers : {}
        // 整个 mcpServers 序列化为 JSON 文本（Claude Desktop 格式 {mcpServers:{...}}），textarea 直接编辑
        form.mcp._json = JSON.stringify({ mcpServers: JSON.parse(JSON.stringify(servers)) }, null, 2)
      }
      const mcpServersFromUi = () => {
        if (!form.mcp) return
        const raw = String(form.mcp._json || '').trim()
        delete form.mcp._json
        if (!raw) { form.mcp.servers = {}; return }
        try {
          const parsed = JSON.parse(raw)
          const servers = parsed && parsed.mcpServers ? parsed.mcpServers : parsed // 兼容 {mcpServers:{...}} 与裸 {...}
          if (servers && typeof servers === 'object' && !Array.isArray(servers)) form.mcp.servers = servers
          else toast('MCP 配置应为对象：{mcpServers:{...}} 或直接服务端对象', 'error')
        } catch (e) {
          toast('MCP 配置 JSON 解析失败：' + (e?.message || e) + '（保留旧配置，请修正后再保存）', 'error')
        }
      }
      const addMcp = () => {
        if (!form.mcp) form.mcp = {}
        if (!form.mcp.servers || typeof form.mcp.servers !== 'object') form.mcp.servers = {}
        let i = 1, name = 'new-server'
        while (form.mcp.servers[name]) name = 'new-server-' + (++i)
        form.mcp.servers[name] = { command: 'npx', args: [], _type: 'stdio', _argsText: '[]', _envText: '', _headersText: '' }
      }
      const delMcp = (name) => { if (form.mcp.servers) delete form.mcp.servers[name] }
      const renameMcp = (oldName, newName) => {
        newName = String(newName || '').trim()
        if (!newName || newName === oldName) return
        if (form.mcp.servers[newName]) { toast('服务名已存在', 'warn'); return }
        const srv = form.mcp.servers[oldName]
        delete form.mcp.servers[oldName]
        form.mcp.servers[newName] = srv
      }

      /* thinking 开关兼容 */
      const thinkingOn = computed({
        get: () => !!form.thinking,
        set: (v) => { form.thinking = v ? { type: 'enabled', budget_tokens: 16000 } : null },
      })

      const tempPct = computed(() => (form.temperature / 2) * 100 + '%')

      /* OpenRouter 模型目录 + key 余额（preset=openrouter 时显示） */
      const orModels = ref([])
      const orSearch = ref('')
      const orLoading = ref(false)
      const loadOrModels = async () => {
        orLoading.value = true
        try { orModels.value = await window.api.get('/openrouter/models'); toast(`已加载 ${orModels.value.length} 个模型`, 'success') }
        catch (e) { toast(e.message, 'error') }
        finally { orLoading.value = false }
      }
      const orFiltered = computed(() => {
        const q = orSearch.value.trim().toLowerCase()
        const all = orModels.value
        if (!q) return all.slice(0, 50)
        return all.filter((m) => (m.id || '').toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q)).slice(0, 50)
      })
      const pickOrModel = (id) => { form.model = id; orSearch.value = ''; toast('已选 ' + id, 'success') }
      const orKey = ref(null)
      const loadOrKey = async () => {
        try { orKey.value = await window.api.get('/openrouter/key'); toast('余额已刷新', 'success') }
        catch (e) { toast(e.message, 'error') }
      }

      return {
        form, dirty, save, reset, sections, open, activeSec, jump, OPT,
        addFallback, delFallback, masterInput, addMaster, delMaster,
        mcpServersToUi, addMcp, delMcp, renameMcp,
        thinkingOn, tempPct,
        orModels, orSearch, orLoading, loadOrModels, orFiltered, pickOrModel, orKey, loadOrKey,
      }
    },
    template: `
    <div class="cfg-layout">
      <!-- 锚点导航 -->
      <div class="cfg-anchor">
        <a v-for="s in sections" :key="s.id" :class="{active: activeSec === s.id}" @click="jump(s.id)">{{ s.name }}</a>
      </div>

      <div>
        <!-- ===== §1.1 基础 / 模型 ===== -->
        <div :id="'cfg-basic'" class="card cfg-section" :class="{open: open.basic}">
          <div class="cfg-section-head" @click="open.basic = !open.basic">
            <span class="ico" style="background:var(--grad-primary)"><v-icon name="cpu"/></span>
            <div><div class="card-title" style="font-size:14px">基础 / 模型</div><div class="card-sub">触发方式、协议预设、主模型与回退</div></div>
            <v-icon class="arrow" name="chevron"/>
          </div>
          <div class="cfg-body" v-show="open.basic"><div class="cfg-grid">
            <cfg-row name="触发模式" desc="at=被@ / command=触发词 / both 两者">
              <select class="select" style="width:150px" v-model="form.trigger"><option v-for="o in OPT.trigger" :value="o[0]">{{ o[1] }}</option></select>
            </cfg-row>
            <cfg-row name="触发词" desc="command/both 时生效">
              <input class="input" style="width:150px" v-model="form.triggerCommand" placeholder="#ai">
            </cfg-row>
            <cfg-row name="协议" desc="API 兼容协议">
              <select class="select" style="width:170px" v-model="form.protocol"><option v-for="o in OPT.protocol" :value="o[0]">{{ o[1] }}</option></select>
            </cfg-row>
            <cfg-row name="厂商预设" desc="自动填 baseURL / headers / 字段映射">
              <select class="select" style="width:170px" v-model="form.preset"><option v-for="o in OPT.preset" :value="o[0]">{{ o[1] }}</option></select>
            </cfg-row>
            <cfg-row name="接口地址 baseURL" desc="OpenAI 兼容接口地址">
              <input class="input" style="width:260px" v-model="form.baseURL" placeholder="https://api.deepseek.com">
            </cfg-row>
            <cfg-row name="API Key" desc="主模型密钥(明文)">
              <input class="input mono" style="width:260px" v-model="form.apiKey" placeholder="sk-...">
            </cfg-row>
            <cfg-row name="主模型 ID" desc="对话主模型">
              <input class="input" style="width:180px" v-model="form.model">
            </cfg-row>
            <div class="full" v-if="form.preset === 'openrouter'" style="margin-top:6px;padding:10px;border:1px dashed var(--border);border-radius:10px">
              <div class="flex between mb8">
                <div style="font-weight:800;font-size:13px">🔍 OpenRouter 模型搜索</div>
                <button class="btn btn-soft btn-sm" @click="loadOrModels">{{ orLoading ? '加载中…' : (orModels.length ? '已加载 '+orModels.length+' 个' : '加载模型目录') }}</button>
              </div>
              <div v-if="orModels.length">
                <input class="input" style="width:100%" v-model="orSearch" placeholder="搜索模型 id/名称（如 gpt / claude / gemini）">
                <div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px;margin-top:6px">
                  <div v-for="m in orFiltered" :key="m.id" @click="pickOrModel(m.id)" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:12px">
                    <b>{{ m.id }}</b> <span class="muted-3">{{ m.name }}<span v-if="m.context"> · {{ Math.round(m.context/1000) }}k ctx</span><span v-if="m.prompt"> · $ {{ (m.prompt * 1000000).toFixed(2) }}/M</span></span>
                  </div>
                </div>
              </div>
              <div class="flex between" style="margin-top:10px">
                <span class="muted" style="font-size:12px">Key 余额</span>
                <button class="btn btn-ghost btn-sm" @click="loadOrKey">查询余额</button>
              </div>
              <div v-if="orKey" class="muted-3" style="font-size:11px;margin-top:4px">
                剩余 $ {{ orKey.limit_remaining ?? '∞' }} / 上限 $ {{ orKey.limit ?? '∞' }} · 已用 $ {{ orKey.usage ?? 0 }}（本月 $ {{ orKey.usage_monthly ?? 0 }}）<span v-if="orKey.is_free_tier"> · 免费层</span>
              </div>
            </div>
            <cfg-row name="旁路小模型" desc="进度播报等旁路任务;留空=主模型">
              <input class="input" style="width:180px" v-model="form.utilityModel" placeholder="留空=主模型">
            </cfg-row>
            <cfg-row name="多用户数据隔离" desc="开启后按 (群,用户) 隔离记忆与会话">
              <v-switch v-model="form.isolation.enable"/>
            </cfg-row>
            <cfg-row name="代理" desc="http 代理(留空=直连)">
              <input class="input mono" style="width:240px" v-model="form.proxy" placeholder="http://127.0.0.1:7890">
            </cfg-row>

            <div class="full">
              <div class="flex between mb10">
                <div style="font-weight:800;font-size:13px">回退模型链</div>
                <button class="btn btn-soft btn-sm" @click="addFallback"><v-icon name="plus"/>添加回退</button>
              </div>
              <TransitionGroup name="list" tag="div" style="display:flex;flex-direction:column;gap:10px;position:relative">
                <div v-for="(fb, i) in form.fallbackModels" :key="i" class="cfg-item" style="background:#fff">
                  <div class="flex gap10 wrap" style="flex:1">
                    <span class="chip chip-outline mono" style="min-width:26px;justify-content:center">{{ i + 1 }}</span>
                    <input class="input" style="width:190px" v-model="fb.model" placeholder="模型 ID">
                    <select class="select" style="width:130px" v-model="fb.protocol"><option v-for="o in OPT.protocol" :value="o[0]">{{ o[1] }}</option></select>
                    <input class="input mono" style="width:170px" v-model="fb.baseURL" placeholder="baseURL">
                    <input class="input mono" style="width:150px" v-model="fb.apiKey" placeholder="apiKey">
                  </div>
                  <button class="icon-btn danger" @click="delFallback(i)"><v-icon name="trash"/></button>
                </div>
              </TransitionGroup>
            </div>
          </div></div>
        </div>

        <!-- ===== §1.2 推理参数 ===== -->
        <div :id="'cfg-reason'" class="card cfg-section" :class="{open: open.reason}">
          <div class="cfg-section-head" @click="open.reason = !open.reason">
            <span class="ico" style="background:var(--grad-sky)"><v-icon name="zap"/></span>
            <div><div class="card-title" style="font-size:14px">推理参数</div><div class="card-sub">采样、轮次、思考预算与上下文</div></div>
            <v-icon class="arrow" name="chevron"/>
          </div>
          <div class="cfg-body" v-show="open.reason"><div class="cfg-grid">
            <cfg-row name="采样温度" desc="0~2,越低越稳定">
              <div class="flex gap10" style="width:200px">
                <input type="range" class="slider" min="0" max="2" step="0.1" v-model.number="form.temperature" :style="{'--fill': tempPct}">
                <b class="num" style="width:30px;text-align:right">{{ form.temperature.toFixed(1) }}</b>
              </div>
            </cfg-row>
            <cfg-row name="工具调用轮次上限" desc="单次请求最多工具往返">
              <input type="number" class="input" style="width:110px" min="1" max="100" v-model.number="form.maxTurns">
            </cfg-row>
            <cfg-row name="重复动作上限" desc="同工具+相同参数连续允许次数(超出→终止,防死循环)">
              <input type="number" class="input" style="width:90px" min="1" v-model.number="form.loop.maxSameAction">
            </cfg-row>
            <cfg-row name="连续失败上限" desc="连续工具失败次数(超出→终止)">
              <input type="number" class="input" style="width:90px" min="1" v-model.number="form.loop.maxConsecutiveFailures">
            </cfg-row>
            <cfg-row name="无进展窗口" desc="连续 N 步无新事实→终止">
              <input type="number" class="input" style="width:90px" min="1" v-model.number="form.loop.noProgressWindow">
            </cfg-row>
            <cfg-row name="时间预算(ms)" desc="单次对话超时(0=不限)">
              <input type="number" class="input" style="width:120px" min="0" step="1000" v-model.number="form.loop.timeBudgetMs">
            </cfg-row>
            <cfg-row name="token 预算" desc="单次对话 token 上限(0=不限)">
              <input type="number" class="input" style="width:120px" min="0" step="1000" v-model.number="form.loop.tokenBudget">
            </cfg-row>
            <cfg-row name="深度思考" desc="模型先思考再作答(更慢更耗 token)">
              <v-switch v-model="thinkingOn"/>
            </cfg-row>
            <cfg-row name="思考预算 tokens" desc="thinking.budget_tokens">
              <input type="number" class="input" style="width:130px" min="1024" step="1024" :disabled="!form.thinking" v-model.number="form.thinking.budget_tokens">
            </cfg-row>
            <cfg-row name="单次回复最大 token" desc="留空=厂商默认">
              <input type="number" class="input" style="width:130px" min="1" v-model.number="form.maxTokens" placeholder="null">
            </cfg-row>
            <cfg-row name="上下文窗口" desc="超 80% 自动压缩历史">
              <input type="number" class="input" style="width:130px" min="1000" v-model.number="form.contextWindow">
            </cfg-row>
            <cfg-row name="工具结果字符上限" desc="超出截断,防爆 context">
              <input type="number" class="input" style="width:130px" min="100" v-model.number="form.maxToolResultChars">
            </cfg-row>
            <cfg-row name="反思模式" desc="回复前自检回环">
              <select class="select" style="width:130px" v-model="form.reflect"><option v-for="o in OPT.reflect" :value="o[0]">{{ o[1] }}</option></select>
            </cfg-row>
            <cfg-row name="反思回环次数" desc="reflectMaxIterations">
              <input type="number" class="input" style="width:110px" min="1" max="5" v-model.number="form.reflectMaxIterations">
            </cfg-row>
            <cfg-row name="回灌推理到历史" desc="默认关:省 context">
              <v-switch v-model="form.keepReasoning"/>
            </cfg-row>
            <cfg-row name="逐字流式输出" desc="依赖适配器,不稳,默认关">
              <v-switch v-model="form.stream"/>
            </cfg-row>
            <cfg-row class="full" name="reasoning 字段映射" desc="不同厂商的推理字段名">
              <tag-editor v-model="form.reasoningFields"/>
            </cfg-row>
          </div></div>
        </div>

        <!-- ===== §1.3 进度 / 回复渲染 ===== -->
        <div :id="'cfg-reply'" class="card cfg-section" :class="{open: open.reply}">
          <div class="cfg-section-head" @click="open.reply = !open.reply">
            <span class="ico" style="background:var(--grad-teal)"><v-icon name="send"/></span>
            <div><div class="card-title" style="font-size:14px">进度 / 回复渲染</div><div class="card-sub">进度消息、渲染方式与中途播报</div></div>
            <v-icon class="arrow" name="chevron"/>
          </div>
          <div class="cfg-body" v-show="open.reply"><div class="cfg-grid">
            <cfg-row name="工具调用进度消息" desc="消除干等,默认开">
              <v-switch v-model="form.progress"/>
            </cfg-row>
            <cfg-row name="进度消息撤回(秒)" desc="0=不撤回">
              <input type="number" class="input" style="width:110px" min="0" max="120" v-model.number="form.progressRecall">
            </cfg-row>
            <cfg-row name="回复渲染方式" desc="image=markdown 渲染精美浅色图">
              <div class="seg">
                <button v-for="o in OPT.replyMode" :class="{active: form.reply.mode === o[0]}" @click="form.reply.mode = o[0]">{{ o[1] }}</button>
              </div>
            </cfg-row>
            <cfg-row name="回复图清晰度倍率" desc="deviceScaleFactor 1~4">
              <input type="number" class="input" style="width:110px" min="1" max="4" v-model.number="form.reply.renderScale">
            </cfg-row>
            <cfg-row name="群聊 @ 发言人" desc="回复时 at 触发者">
              <v-switch v-model="form.reply.atSender"/>
            </cfg-row>
            <cfg-row name="中途播报" desc="调工具时顺带转发思路/进展">
              <v-switch v-model="form.reply.narrate"/>
            </cfg-row>
          </div></div>
        </div>

        <!-- ===== §1.4 记忆系统 ===== -->
        <div :id="'cfg-memory'" class="card cfg-section" :class="{open: open.memory}">
          <div class="cfg-section-head" @click="open.memory = !open.memory">
            <span class="ico" style="background:var(--grad-amber)"><v-icon name="memory"/></span>
            <div><div class="card-title" style="font-size:14px">记忆系统</div><div class="card-sub">声明式记忆 + 长期记忆召回</div></div>
            <v-icon class="arrow" name="chevron"/>
          </div>
          <div class="cfg-body" v-show="open.memory"><div class="cfg-grid">
            <cfg-row name="声明式记忆" desc="注入 MEMORY.md / USER.md 到 system">
              <v-switch v-model="form.memory.enable"/>
            </cfg-row>
            <cfg-row name="记忆注入扫描" desc="写长期记忆前扫描指令注入">
              <v-switch v-model="form.memory.threatScan"/>
            </cfg-row>
            <cfg-row name="MEMORY 字符上限" desc="Agent 个人笔记上限">
              <input type="number" class="input" style="width:120px" min="200" v-model.number="form.memoryLimits.memory">
            </cfg-row>
            <cfg-row name="USER 字符上限" desc="用户画像上限">
              <input type="number" class="input" style="width:120px" min="200" v-model.number="form.memoryLimits.user">
            </cfg-row>
            <cfg-row name="长期记忆条数上限" desc="每用户;超限按价值淘汰">
              <input type="number" class="input" style="width:120px" min="10" v-model.number="form.recall.cap">
            </cfg-row>
            <cfg-row name="LLM 抽取间隔(轮)" desc="每 N 轮触发一次抽取">
              <input type="number" class="input" style="width:120px" min="1" v-model.number="form.recall.extractEvery">
            </cfg-row>
            <cfg-row name="抽取用模型" desc="留空=utilityModel→主模型">
              <input class="input" style="width:170px" v-model="form.recall.model" placeholder="留空=主模型">
            </cfg-row>
            <cfg-row name="语义召回 embedding" desc="留空=关键词 jaccard 召回">
              <input class="input" style="width:170px" v-model="form.recall.embedProvider" placeholder="留空=关键词召回">
            </cfg-row>
          </div></div>
        </div>

        <!-- ===== §1.5 自进化 ===== -->
        <div :id="'cfg-evolution'" class="card cfg-section" :class="{open: open.evolution}">
          <div class="cfg-section-head" @click="open.evolution = !open.evolution">
            <span class="ico" style="background:var(--grad-rose)"><v-icon name="evolution"/></span>
            <div><div class="card-title" style="font-size:14px">自进化</div><div class="card-sub">后台自评审与改进建议落盘</div></div>
            <v-icon class="arrow" name="chevron"/>
          </div>
          <div class="cfg-body" v-show="open.evolution"><div class="cfg-grid">
            <cfg-row name="后台自评审" desc="每 N 轮异步评审,不阻塞回复">
              <v-switch v-model="form.selfReview.enable"/>
            </cfg-row>
            <cfg-row name="评审间隔(轮)" desc="每 N 轮触发一次">
              <input type="number" class="input" style="width:120px" min="5" v-model.number="form.selfReview.every">
            </cfg-row>
            <cfg-row name="评审用模型" desc="建议廉价小模型降本">
              <input class="input" style="width:170px" v-model="form.selfReview.model" placeholder="留空=主模型">
            </cfg-row>
            <cfg-row name="日 token 预算" desc="耗尽则只采迹不评审">
              <input type="number" class="input" style="width:150px" min="0" step="10000" v-model.number="form.selfReview.dailyBudgetTokens">
            </cfg-row>
            <cfg-row name="记忆自动应用" desc="有回滚+威胁扫描+置信度闸">
              <v-switch v-model="form.selfReview.autoApplyMemory"/>
            </cfg-row>
            <cfg-row name="prompt 自动应用" desc="默认关:落盘待审,人工把关" danger>
              <v-switch v-model="form.selfReview.autoApplyPrompt"/>
            </cfg-row>
            <cfg-row class="full" name="产物目录" desc="traces / prompts / suggestions">
              <div class="flex gap6 wrap" style="justify-content:flex-end">
                <span class="chip mono">{{ form.evolution.traceDir }}</span>
                <span class="chip mono">{{ form.evolution.promptDir }}</span>
                <span class="chip mono">{{ form.evolution.suggestionDir }}</span>
              </div>
            </cfg-row>
            <div class="full" style="margin-top:6px;padding-top:10px;border-top:1px dashed var(--border)">
              <div class="muted" style="font-size:12px;font-weight:700;margin-bottom:8px"><v-icon name="tool"/> 工具进化（Tool Evolution）</div>
              <div class="cfg-grid">
                <cfg-row name="工具进化" desc="版本化工具库(生成→验证→审批→晋升)">
                  <v-switch v-model="form.toolEvo.enable"/>
                </cfg-row>
                <cfg-row name="候选修复次数" desc="生成失败自动修复上限">
                  <input type="number" class="input" style="width:90px" min="0" max="3" v-model.number="form.toolEvo.maxRepairAttempts">
                </cfg-row>
                <cfg-row name="检索接受阈值" desc="与去重阈值分开(§12.1)">
                  <input type="number" class="input" style="width:100px" min="0" max="1" step="0.01" v-model.number="form.toolEvo.retrievalThreshold">
                </cfg-row>
                <cfg-row name="去重阈值" desc="候选去重相似度">
                  <input type="number" class="input" style="width:100px" min="0" max="1" step="0.01" v-model.number="form.toolEvo.deduplicationThreshold">
                </cfg-row>
              </div>
            </div>
          </div></div>
        </div>

        <!-- ===== §1.6 权限 / 安全 / 日志 ===== -->
        <div :id="'cfg-security'" class="card cfg-section" :class="{open: open.security}">
          <div class="cfg-section-head" @click="open.security = !open.security">
            <span class="ico" style="background:var(--grad-primary)"><v-icon name="shield"/></span>
            <div><div class="card-title" style="font-size:14px">权限 / 安全 / 日志</div><div class="card-sub">主人、审批、注入防御与全链路日志</div></div>
            <v-icon class="arrow" name="chevron"/>
          </div>
          <div class="cfg-body" v-show="open.security"><div class="cfg-grid">
            <cfg-row name="#ai 命令权限" desc="谁可以触发对话">
              <select class="select" style="width:140px" v-model="form.chatPermission"><option v-for="o in OPT.permission" :value="o[0]">{{ o[1] }}</option></select>
            </cfg-row>
            <cfg-row name="确认超时(秒)" desc="审批门超时自动拒绝">
              <input type="number" class="input" style="width:120px" min="10" v-model.number="form.confirmTimeout">
            </cfg-row>
            <cfg-row name="注入防御动作" desc="命中提示词注入时的处理">
              <select class="select" style="width:170px" v-model="form.guardAction"><option v-for="o in OPT.guardAction" :value="o[0]">{{ o[1] }}</option></select>
            </cfg-row>
            <cfg-row name="防御灵敏度" desc="阈值越低越严格">
              <select class="select" style="width:150px" v-model="form.guardSensitivity"><option v-for="o in OPT.guardSensitivity" :value="o[0]">{{ o[1] }}</option></select>
            </cfg-row>
            <cfg-row name="回复脱敏" desc="发送前屏蔽密钥/token">
              <v-switch v-model="form.redactSecrets"/>
            </cfg-row>
            <cfg-row name="全链路日志 devLog" desc="每会话一个日志文件">
              <v-switch v-model="form.devLog.enable"/>
            </cfg-row>
            <cfg-row name="主人任务免确认" desc="主人发起的确认类工具跳过审批,高危!" danger>
              <v-switch v-model="form.masterSkipConfirm"/>
            </cfg-row>
            <cfg-row name="日志级别" desc="devLog.level">
              <select class="select" style="width:120px" v-model="form.devLog.level"><option value="info">info</option><option value="warn">warn</option><option value="debug">debug</option></select>
            </cfg-row>
            <cfg-row class="full" name="主人列表" desc="主人 QQ 号(明文,点标签删除)">
              <div class="flex gap6 wrap" style="justify-content:flex-end">
                <span v-for="(m, i) in form.masters" :key="i" class="chip chip-outline mono" style="cursor:pointer" @click="delMaster(i)" title="点击删除">{{ m }} <v-icon name="x"/></span>
                <input class="input" style="width:130px;padding:4px 9px;font-size:12px" v-model="masterInput" placeholder="输入 QQ 回车添加" @keydown.enter.prevent="addMaster">
              </div>
            </cfg-row>
            <cfg-row class="full" name="默认身份 systemPrompt" desc="留空用富默认身份;被人设覆盖时失效">
              <textarea class="textarea" style="min-height:64px" v-model="form.systemPrompt" placeholder="留空=使用内置默认身份"></textarea>
            </cfg-row>
          </div></div>
        </div>

        <!-- ===== §1.7 多模态 / 工具 / 扩展 ===== -->
        <div :id="'cfg-ext'" class="card cfg-section" :class="{open: open.ext}">
          <div class="cfg-section-head" @click="open.ext = !open.ext">
            <span class="ico" style="background:var(--grad-sky)"><v-icon name="tool"/></span>
            <div><div class="card-title" style="font-size:14px">多模态 / 工具 / 扩展</div><div class="card-sub">视觉、搜索、MCP、终端与各子系统</div></div>
            <v-icon class="arrow" name="chevron"/>
          </div>
          <div class="cfg-body" v-show="open.ext"><div class="cfg-grid">
            <cfg-row name="多模态" desc="图片/文件输入总开关">
              <v-switch v-model="form.media.enable"/>
            </cfg-row>
            <cfg-row name="单次最多图片" desc="media.maxImages">
              <input type="number" class="input" style="width:110px" min="1" max="20" v-model.number="form.media.maxImages">
            </cfg-row>
            <cfg-row name="视觉子模型" desc="主模型无视觉时图转文">
              <v-switch v-model="form.vision.enable"/>
            </cfg-row>
            <cfg-row name="视觉模型 Key" desc="空则复用主 apiKey">
              <input class="input mono" style="width:240px" v-model="form.vision.apiKey" placeholder="留空=复用主 Key">
            </cfg-row>
            <cfg-row name="工具按需发现" desc="常驻少数工具,其余 tool_search 动态注入">
              <v-switch v-model="form.toolDiscovery.enable"/>
            </cfg-row>
            <cfg-row name="tool_search 返回数 / 最低分" desc="topK 与 minScore">
              <div class="flex gap6">
                <input type="number" class="input" style="width:80px" min="1" max="20" v-model.number="form.toolDiscovery.topK">
                <input type="number" class="input" style="width:90px" min="0" max="1" step="0.05" v-model.number="form.toolDiscovery.minScore">
              </div>
            </cfg-row>
            <cfg-row class="full" name="常驻工具" desc="不经搜索始终可用">
              <tag-editor v-model="form.toolDiscovery.alwaysOn"/>
            </cfg-row>

            <cfg-row name="Tavily 搜索 Key" desc="任填一个搜索源即启用">
              <input class="input mono" style="width:220px" v-model="form.search.tavily.apiKey" placeholder="tvly-...">
            </cfg-row>
            <cfg-row class="full" name="Exa / Brave / PPLX Key" desc="其余搜索源密钥(明文)">
              <div class="flex gap6 wrap">
                <input class="input mono" style="width:150px" v-model="form.search.exa.apiKey" placeholder="Exa">
                <input class="input mono" style="width:150px" v-model="form.search.brave.apiKey" placeholder="Brave">
                <input class="input mono" style="width:150px" v-model="form.search.perplexity.apiKey" placeholder="Perplexity">
              </div>
            </cfg-row>
            <cfg-row name="DDG 兜底" desc="本地 DuckDuckGo,免 key">
              <v-switch v-model="form.search.ddg"/>
            </cfg-row>
            <cfg-row name="深度研究权限" desc="#研究 命令">
              <select class="select" style="width:170px" v-model="form.research.permission"><option v-for="o in OPT.researchPerm" :value="o[0]">{{ o[1] }}</option></select>
            </cfg-row>
            <cfg-row class="full" name="米游社 Cookie" desc="明文">
              <input class="input mono" style="width:100%" v-model="form.miyoushe.cookie" placeholder="cookie 字符串">
            </cfg-row>
            <cfg-row class="full" name="Pixiv refreshToken" desc="明文">
              <input class="input mono" style="width:100%" v-model="form.pixiv.refreshToken" placeholder="refresh token">
            </cfg-row>
            <cfg-row name="语音转写 STT" desc="whisper 兼容接口">
              <v-switch v-model="form.stt.enable"/>
            </cfg-row>
            <cfg-row name="表情包系统" desc="sticker.enable">
              <v-switch v-model="form.sticker.enable"/>
            </cfg-row>
            <cfg-row name="Python 计算沙盒" desc="calc:python3 超时秒">
              <div class="flex gap6">
                <v-switch v-model="form.calc.enable"/>
                <input type="number" class="input" style="width:90px" min="1" v-model.number="form.calc.timeout">
              </div>
            </cfg-row>
            <!-- MCP 服务端已拆到独立「MCP 服务」section -->

            <div class="full" style="border:1.5px dashed #f0b6c2;border-radius:12px;padding:14px;background:linear-gradient(180deg,#fff,#fff8f9)">
              <div class="flex gap10 mb10" style="font-weight:800;color:var(--rose)"><v-icon name="warn"/>终端执行(高危)</div>
              <div class="cfg-grid">
                <cfg-row name="启用 shell 执行" desc="即使有审批/黑白名单也无法 100% 安全" danger>
                  <v-switch v-model="form.terminal.enable"/>
                </cfg-row>
                <cfg-row name="命令超时上限(秒)">
                  <input type="number" class="input" style="width:110px" min="1" max="3600" v-model.number="form.terminal.maxTimeout">
                </cfg-row>
                <cfg-row name="沙盒镜像" desc="需先 docker pull">
                  <input class="input mono" style="width:170px" v-model="form.terminal.image">
                </cfg-row>
                <cfg-row name="沙盒网络">
                  <select class="select" style="width:190px" v-model="form.terminal.network"><option v-for="o in OPT.termNet" :value="o[0]">{{ o[1] }}</option></select>
                </cfg-row>
                <cfg-row class="full" name="命令黑名单" desc="命中硬拦">
                  <tag-editor v-model="form.terminal.blocklist" placeholder="回车添加"/>
                </cfg-row>
              </div>
            </div>
          </div></div>
        </div>

        <!-- ===== MCP 服务（独立 section）===== -->
        <div :id="'cfg-mcp'" class="card cfg-section" :class="{open: open.mcp}">
          <div class="cfg-section-head" @click="open.mcp = !open.mcp">
            <span class="ico" style="background:var(--grad-teal)"><v-icon name="tool"/></span>
            <div><div class="card-title" style="font-size:14px">MCP 服务</div><div class="card-sub">MCP 协议服务端（stdio / http）· 请求超时</div></div>
            <v-icon class="arrow" name="chevron"/>
          </div>
          <div class="cfg-body" v-show="open.mcp"><div class="cfg-grid">
            <cfg-row name="MCP 请求超时(ms)" desc="mcp.requestTimeout">
              <input type="number" class="input" style="width:130px" min="1000" step="1000" v-model.number="form.mcp.requestTimeout">
            </cfg-row>
            <div class="full">
              <div class="flex between mb10">
                <div style="font-weight:800;font-size:13px">MCP 服务端配置 <span class="muted-3" style="font-weight:400;font-size:11.5px">粘贴完整 mcpServers JSON（Claude Desktop 格式）</span></div>
              </div>
              <textarea class="textarea mono" style="min-height:280px;width:100%;font-size:12px" v-model="form.mcp._json" spellcheck="false" placeholder='{ "mcpServers": { "zai-mcp-server": { "type": "stdio", "command": "npx", "args": ["-y", "@z_ai/mcp-server"], "env": { "Z_AI_API_KEY": "YOUR_API_KEY" } } } }'></textarea>
              <div class="muted-3" style="font-size:11px;margin-top:4px">支持 stdio(command/args/env) 与 http(url/headers)；外层 mcpServers 可省略（直接粘服务端对象）。保存时解析覆盖。</div>
            </div>
          </div></div>
        </div>

        <!-- 保存栏 -->
        <Transition name="fade">
          <div v-if="dirty" class="cfg-savebar">
            <span class="dirty-dot"></span>
            <span style="font-weight:700;font-size:13px">有未保存的修改</span>
            <span class="muted-3" style="font-size:12px">Mock 环境:保存仅写入内存,刷新还原</span>
            <div style="margin-left:auto" class="flex gap10">
              <button class="btn btn-ghost" @click="reset"><v-icon name="undo"/>放弃修改</button>
              <button class="btn btn-primary" @click="save"><v-icon name="save"/>保存并热加载</button>
            </div>
          </div>
        </Transition>
      </div>

    </div>`,
  }
})()
