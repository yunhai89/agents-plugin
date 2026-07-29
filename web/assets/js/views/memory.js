/** 视图:声明式记忆(§2.1 · 按 scope 隔离) */
(function () {
  window.VIEWS = window.VIEWS || {}

  window.VIEWS.memory = {
    name: 'MemoryView',
    setup() {
      const { ref, computed, onMounted, watch } = Vue
      const { toast, fmt } = window.UI
      const M = window.MOCK

      const scopeId = ref(M.scopes[0]?.scopeId || '')
      const tab = ref('memory') // memory=MEMORY.md / user=USER.md
      const data = computed(() => M.memories[scopeId.value]?.[tab.value] || { usedChars: 0, limitChars: 0, entries: [] })
      const pct = computed(() => fmt.pct(data.value.usedChars, data.value.limitChars))
      const scopeInfo = computed(() => M.scopes.find((s) => s.scopeId === scopeId.value))

      /* 编辑 / 新增 → PUT 全量条目,成功重拉 */
      const editor = ref({ show: false, idx: -1, text: '' })
      const openAdd = () => { editor.value = { show: true, idx: -1, text: '' } }
      const openEdit = (i) => { editor.value = { show: true, idx: i, text: data.value.entries[i] } }
      const applyEdit = async () => {
        const t = editor.value.text.trim()
        if (!t) return
        const entries = data.value.entries.slice()
        if (editor.value.idx === -1) entries.push(t)
        else entries[editor.value.idx] = t
        try {
          await window.api.put(`/memories/${scopeId.value}/${tab.value}`, { entries })
          await window.store.loadMemories(scopeId.value)
          toast(editor.value.idx === -1 ? '已添加记忆条目' : '已更新条目')
        } catch (e) { toast(e.message, 'error') }
        editor.value.show = false
      }
      const del = async (i) => {
        const entries = data.value.entries.slice()
        entries.splice(i, 1)
        try {
          await window.api.put(`/memories/${scopeId.value}/${tab.value}`, { entries })
          await window.store.loadMemories(scopeId.value)
          toast('已删除条目', 'info')
        } catch (e) { toast(e.message, 'error') }
      }

      const fileName = computed(() => (tab.value === 'memory' ? 'MEMORY.md' : 'USER.md'))
      const headerLine = computed(() => {
        const d = data.value
        const label = tab.value === 'memory' ? 'MEMORY (your personal notes)' : 'USER (about the user)'
        return `${label} [${pct.value}% — ${d.usedChars}/${d.limitChars} chars]`
      })

      /* 惰性加载:先拉 scope 列表定默认值,再拉该 scope 记忆;切 scope 重拉 */
      onMounted(async () => {
        try {
          await window.store.loadScopes()
          if (!scopeId.value && M.scopes[0]) scopeId.value = M.scopes[0].scopeId
          if (scopeId.value) await window.store.loadMemories(scopeId.value)
        } catch (e) { toast(e.message, 'error') }
      })
      watch(scopeId, (v) => { if (v) window.store.loadMemories(v).catch((e) => toast(e.message, 'error')) })

      return { scopeId, tab, data, pct, scopeInfo, editor, openAdd, openEdit, applyEdit, del, fileName, headerLine }
    },
    template: `
    <div>
      <div class="card card-pad" style="--i:0">
        <div class="flex between wrap gap14">
          <scope-picker v-model="scopeId"/>
          <div class="seg">
            <button :class="{active: tab === 'memory'}" @click="tab = 'memory'">MEMORY.md</button>
            <button :class="{active: tab === 'user'}" @click="tab = 'user'">USER.md</button>
          </div>
        </div>
        <div class="muted-3 mt10" style="font-size:12px">
          路径 <span class="mono">data/memories/{{ scopeId }}/{{ fileName }}</span>
          · scopeId 规则:私聊 u_qq / 群隔离 g群_uqq / 群共享 g群;同一用户在不同群是独立数据集
        </div>
      </div>

      <div class="grid mt16" style="grid-template-columns: 300px 1fr">
        <!-- 用量 -->
        <div class="card card-pad hoverable flex" style="--i:1;flex-direction:column;align-items:center;gap:14px">
          <ring-progress :percent="pct" :key="scopeId + tab">
            <template #default="{ percent }">
              <div style="font-size:26px;font-weight:800" class="num">{{ percent }}<span style="font-size:14px">%</span></div>
              <div class="muted-3" style="font-size:11px">容量占用</div>
            </template>
          </ring-progress>
          <div style="text-align:center">
            <div class="num" style="font-weight:800;font-size:15px">{{ data.usedChars }} / {{ data.limitChars }} <span style="font-size:11px" class="muted">chars</span></div>
            <div class="muted-3" style="font-size:11.5px;margin-top:2px">{{ data.entries.length }} 条 bullet 条目</div>
          </div>
          <div class="progress" :class="pct > 85 ? 'rose' : pct > 60 ? 'amber' : 'teal'" style="width:100%">
            <i :style="{width: pct + '%'}"></i>
          </div>
        </div>

        <!-- 条目 -->
        <div class="card card-pad" style="--i:2">
          <div class="flex between mb16">
            <div>
              <div class="card-title"><v-icon name="memory"/>{{ fileName }} 条目</div>
              <div class="card-sub mono" style="font-size:11px">{{ headerLine }}</div>
            </div>
            <button class="btn btn-primary btn-sm" @click="openAdd"><v-icon name="plus"/>新增条目</button>
          </div>
          <TransitionGroup name="list" tag="div" style="display:flex;flex-direction:column;gap:9px;position:relative">
            <div v-for="(e, i) in data.entries" :key="e + i" class="mem-entry">
              <span class="idx">{{ i + 1 }}</span>
              <span class="txt">{{ e }}</span>
              <button class="icon-btn" @click="openEdit(i)"><v-icon name="edit"/></button>
              <button class="icon-btn danger" @click="del(i)"><v-icon name="trash"/></button>
            </div>
          </TransitionGroup>
          <empty-state v-if="!data.entries.length" icon="memory" text="此 scope 暂无记忆" sub="Agent 会在对话中自动沉淀,也可手动新增"/>
        </div>
      </div>

      <!-- 编辑弹窗 -->
      <v-modal v-if="editor.show" :title="editor.idx === -1 ? '新增记忆条目' : '编辑条目 #' + (editor.idx + 1)" icon="edit" @close="editor.show = false">
        <div class="field">
          <label class="field-label">条目内容(一条 bullet)</label>
          <textarea class="textarea" v-model="editor.text" maxlength="500" placeholder="例如:用户偏好简洁回答"></textarea>
          <span class="field-help">写入 {{ scopeInfo?.label }} 的 {{ fileName }};超过上限会触发淘汰策略(模拟)。</span>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="editor.show = false">取消</button>
          <button class="btn btn-primary" @click="applyEdit"><v-icon name="check"/>保存(模拟)</button>
        </template>
      </v-modal>
    </div>`,
  }
})()
