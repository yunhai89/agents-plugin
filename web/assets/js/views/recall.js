/** 视图:长期记忆 recall(§3.3 · KV · 按用户) */
(function () {
  window.VIEWS = window.VIEWS || {}

  const LEVEL = {
    L2: { name: 'L2 近期', cls: 'chip-sky', desc: '近期上下文事实' },
    L3: { name: 'L3 偏好', cls: 'chip-violet', desc: '用户偏好' },
    L4: { name: 'L4 事实', cls: 'chip-teal', desc: '稳定事实/身份' },
  }

  window.VIEWS.recall = {
    name: 'RecallView',
    setup() {
      const { ref, computed, onMounted, watch } = Vue
      const { toast, fmt } = window.UI
      const M = window.MOCK

      /* 用户清单来自 scope 列表(唯一 userId);recall 接口按单用户取 */
      const userIds = computed(() => [...new Set((M.scopes || []).map((s) => s.userId).filter(Boolean))])
      const userId = ref('')
      const level = ref('all')
      const showSuspect = ref(true)

      const entries = computed(() => (M.recall[userId.value] || [])
        .filter((e) => level.value === 'all' || e.level === level.value)
        .filter((e) => showSuspect.value || !e.suspect)
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt))

      const expanded = ref({})
      const toggle = (id) => { expanded.value[id] = !expanded.value[id] }

      const del = async (e) => {
        try {
          await window.api.del(`/recall/${userId.value}/${e.id}`)
          await window.store.loadRecall(userId.value)
          toast('已删除该条长期记忆', 'info')
        } catch (err) { toast(err.message, 'error') }
      }

      const addModal = ref({ show: false, level: 'L3', type: 'preference', content: '', confidence: 0.8 })
      const add = async () => {
        const m = addModal.value
        if (!m.content.trim()) return
        try {
          await window.api.post(`/recall/${userId.value}`, {
            level: m.level, type: m.type, content: m.content.trim(), confidence: m.confidence,
          })
          await window.store.loadRecall(userId.value)
          toast('已写入长期记忆(已过威胁扫描)')
          addModal.value.show = false
          addModal.value.content = ''
        } catch (err) { toast(err.message, 'error') }
      }

      /* 惰性加载:scope 列表定默认用户 → 拉该用户 recall;切用户重拉 */
      onMounted(async () => {
        try {
          await window.store.loadScopes()
          if (!userId.value && userIds.value[0]) userId.value = userIds.value[0]
          if (userId.value) await window.store.loadRecall(userId.value)
        } catch (e) { toast(e.message, 'error') }
      })
      watch(userId, (v) => { if (v) window.store.loadRecall(v).catch((e) => toast(e.message, 'error')) })

      return { userIds, userId, level, showSuspect, entries, expanded, toggle, del, addModal, add, LEVEL, fmt }
    },
    template: `
    <div>
      <div class="card card-pad" style="--i:0">
        <div class="flex between wrap gap14">
          <div class="scope-bar">
            <span class="muted" style="font-size:12.5px;font-weight:700">用户</span>
            <div v-for="u in userIds" :key="u" class="scope-pill" :class="{active: u === userId}" @click="userId = u">
              <v-icon name="user"/><span class="mono">{{ u }}</span>
            </div>
          </div>
          <div class="flex gap10 wrap">
            <div class="seg">
              <button :class="{active: level === 'all'}" @click="level = 'all'">全部</button>
              <button v-for="(v, k) in LEVEL" :key="k" :class="{active: level === k}" @click="level = k">{{ k }}</button>
            </div>
            <span class="chip" :class="showSuspect ? 'chip-amber' : ''" style="cursor:pointer" @click="showSuspect = !showSuspect">
              <v-icon name="shield"/>{{ showSuspect ? '含可疑条目' : '已隐藏可疑' }}
            </span>
            <button class="btn btn-primary btn-sm" @click="addModal.show = true"><v-icon name="plus"/>写入记忆</button>
          </div>
        </div>
        <div class="muted-3 mt10" style="font-size:12px">
          键 <span class="mono">Yz:agent:mem:{{ userId }}</span> · 上限 200 条,超限按价值淘汰 · 命中注入扫描的条目召回屏蔽但排查保留
        </div>
      </div>

      <TransitionGroup name="list" tag="div" class="grid grid-2 mt16" style="position:relative">
        <div v-for="(e, i) in entries" :key="e.id" class="card recall-card hoverable" :class="{suspect: e.suspect}" :style="{'--i': i}">
          <div class="flex between">
            <div class="flex gap6 wrap">
              <span class="chip" :class="LEVEL[e.level].cls">{{ LEVEL[e.level].name }}</span>
              <span class="chip chip-outline mono">{{ e.type }}</span>
              <span v-if="e.suspect" class="chip chip-rose"><v-icon name="warn"/>疑似注入</span>
            </div>
            <button class="icon-btn danger" @click="del(e)"><v-icon name="trash"/></button>
          </div>
          <p class="mt10" style="font-size:13px;line-height:1.7">{{ e.content }}</p>
          <div class="flex between mt10">
            <div class="flex gap10" style="align-items:center">
              <div class="progress conf-bar" :class="e.confidence > 0.85 ? 'teal' : e.confidence > 0.6 ? '' : 'amber'">
                <i :style="{width: e.confidence * 100 + '%'}"></i>
              </div>
              <span class="muted num" style="font-size:11.5px">置信 {{ (e.confidence * 100).toFixed(0) }}%</span>
            </div>
            <span class="muted-3" style="font-size:11.5px">更新于 {{ fmt.ago(e.updatedAt) }}</span>
          </div>
          <div v-if="e.prev && e.prev.length" class="mt10">
            <span class="chip chip-outline" style="cursor:pointer;font-size:10.5px" @click="toggle(e.id)">
              <v-icon name="clock"/>{{ expanded[e.id] ? '收起历史版本' : e.prev.length + ' 个被覆盖旧值' }}
            </span>
            <Transition name="expand">
              <div v-if="expanded[e.id]" class="mt10" style="display:flex;flex-direction:column;gap:6px">
                <div v-for="(p, j) in e.prev" :key="j" style="padding:8px 11px;border-radius:8px;background:var(--surface-3);font-size:12px" class="muted">
                  <s>{{ p.content }}</s>
                  <span class="muted-3" style="margin-left:8px;font-size:11px">置信 {{ (p.confidence * 100).toFixed(0) }}% · {{ fmt.ago(p.updatedAt) }}</span>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </TransitionGroup>
      <empty-state v-if="!entries.length" icon="recall" text="该筛选下暂无记忆条目"/>

      <!-- 写入弹窗 -->
      <v-modal v-if="addModal.show" title="写入长期记忆(模拟)" icon="plus" @close="addModal.show = false">
        <div class="grid grid-2" style="gap:14px">
          <div class="field">
            <label class="field-label">层级</label>
            <select class="select" v-model="addModal.level"><option v-for="(v, k) in LEVEL" :value="k">{{ v.name }} · {{ v.desc }}</option></select>
          </div>
          <div class="field">
            <label class="field-label">类型</label>
            <select class="select" v-model="addModal.type">
              <option value="preference">preference 偏好</option><option value="name">name 称呼</option>
              <option value="identity">identity 身份</option><option value="fact">fact 事实</option>
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="field-label">内容</label>
            <textarea class="textarea" v-model="addModal.content" placeholder="例如:用户周五晚上有固定开黑活动"></textarea>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label class="field-label">置信度 {{ (addModal.confidence * 100).toFixed(0) }}%</label>
            <input type="range" class="slider" min="0.1" max="1" step="0.05" v-model.number="addModal.confidence" :style="{'--fill': addModal.confidence * 100 + '%'}">
          </div>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="addModal.show = false">取消</button>
          <button class="btn btn-primary" @click="add"><v-icon name="check"/>写入(模拟)</button>
        </template>
      </v-modal>
    </div>`,
  }
})()
