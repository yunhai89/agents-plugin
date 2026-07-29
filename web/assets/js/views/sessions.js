/** 视图:会话回放(§3.1 session + §3.2 conversation) */
(function () {
  window.VIEWS = window.VIEWS || {}

  window.VIEWS.sessions = {
    name: 'SessionsView',
    setup() {
      const { ref, computed, onMounted, watch } = Vue
      const M = window.MOCK
      const { fmt } = window.UI

      /* conversations/sessions 接口需 userId+groupId;视图无选择器,默认取首个 scope */
      const userId = ref('')
      const groupId = ref('')
      const activeId = ref('')
      const convs = computed(() => M.conversations)
      const conv = computed(() => M.conversations.find((c) => c.id === activeId.value))
      const session = computed(() => M.sessions[activeId.value] || { messages: [] })

      const showReasoning = ref({})
      const showArgs = ref({})
      const toggleR = (i) => { showReasoning.value[i] = !showReasoning.value[i] }
      const toggleA = (i, j) => { showArgs.value[i + '_' + j] = !showArgs.value[i + '_' + j] }

      const parseArgs = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2) } catch { return s } }

      /* 切对话 → 拉该会话消息 */
      watch(activeId, (id) => {
        if (!id) return
        window.store.loadSession(id, userId.value, groupId.value || 'private').catch(() => {})
      })

      /* 惰性加载:scope 定默认用户/群 → 拉对话列表 → 默认选第一条(触发上面 watch 拉 session) */
      onMounted(async () => {
        try {
          await window.store.loadScopes()
          const s = M.scopes[0]
          if (s) { userId.value = s.userId; groupId.value = s.groupId || '' }
          await window.store.loadConversations(userId.value, groupId.value || 'private')
          if (M.conversations[0]) activeId.value = M.conversations[0].id
        } catch { /* 忽略,运行时未就绪时列表为空 */ }
      })

      return { convs, activeId, conv, session, showReasoning, showArgs, toggleR, toggleA, parseArgs, fmt }
    },
    template: `
    <div class="grid" style="grid-template-columns: 320px 1fr;align-items:start">
      <!-- 对话列表 -->
      <div class="card card-pad" style="--i:0">
        <div class="card-title mb10"><v-icon name="session"/>对话列表</div>
        <div class="muted-3 mb16" style="font-size:11.5px">按用户维护多对话,active 指针切换;滑动窗口保留 20 条</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div v-for="c in convs" :key="c.id" class="conv-item" :class="{active: c.id === activeId}" @click="activeId = c.id">
            <div class="flex between">
              <span style="font-weight:700;font-size:13px" class="ellipsis">{{ c.title }}</span>
              <span class="chip chip-primary" style="flex:0 0 auto">{{ c.count }}</span>
            </div>
            <div class="muted ellipsis" style="font-size:11.5px;margin-top:3px">{{ c.preview }}</div>
            <div class="muted-3" style="font-size:10.5px;margin-top:4px">更新 {{ fmt.ago(c.updatedAt) }}</div>
          </div>
        </div>
      </div>

      <!-- 消息流 -->
      <div class="card" style="--i:1;overflow:hidden">
        <div class="flex between" style="padding:15px 20px;border-bottom:1px solid var(--border);background:var(--surface-2)">
          <div>
            <div style="font-weight:800;font-size:14px">{{ conv?.title }}</div>
            <div class="muted-3 mono" style="font-size:11px">{{ session.key }}</div>
          </div>
          <span class="chip chip-teal"><v-icon name="user"/>{{ session.scopeUserId }}</span>
        </div>
        <div class="chat-pane" style="max-height:640px;overflow-y:auto">
          <template v-for="(m, i) in session.messages" :key="i">
            <!-- system -->
            <div v-if="m.role === 'system'" class="bubble-row">
              <div class="bubble system"><b>SYSTEM</b> · {{ m.content }}</div>
            </div>
            <!-- user -->
            <div v-else-if="m.role === 'user'" class="bubble-row user">
              <div class="bubble-ava" style="background:var(--grad-amber)">我</div>
              <div class="bubble user">{{ m.content }}</div>
            </div>
            <!-- assistant -->
            <div v-else-if="m.role === 'assistant'" class="bubble-row">
              <div class="bubble-ava" style="background:var(--grad-primary)"><v-icon name="bot" style="width:16px;height:16px"/></div>
              <div style="max-width:76%">
                <div class="bubble assistant" style="max-width:100%">
                  <span v-if="m.content" style="white-space:pre-wrap">{{ m.content }}</span>
                  <span v-else class="muted-3" style="font-size:12px">(无文本,仅工具调用)</span>
                  <div v-if="m.reasoning">
                    <span class="tool-call-tag" style="background:var(--violet-soft);color:var(--violet)" @click="toggleR(i)">
                      <v-icon name="memory"/>推理过程 {{ showReasoning[i] ? '▲' : '▼' }}
                    </span>
                    <Transition name="expand"><pre v-if="showReasoning[i]" class="code mt10" style="white-space:pre-wrap">{{ m.reasoning }}</pre></Transition>
                  </div>
                  <div v-if="m.tool_calls">
                    <span v-for="(tc, j) in m.tool_calls" :key="tc.id" class="tool-call-tag" @click="toggleA(i, j)">
                      <v-icon name="tool"/>{{ tc.function.name }} {{ showArgs[i + '_' + j] ? '▲' : '▼' }}
                    </span>
                    <Transition name="expand">
                      <div v-if="m.tool_calls.some((tc, j) => showArgs[i + '_' + j])">
                        <pre v-for="(tc, j) in m.tool_calls" v-show="showArgs[i + '_' + j]" :key="tc.id" class="code mt10">{{ parseArgs(tc.function.arguments) }}</pre>
                      </div>
                    </Transition>
                  </div>
                </div>
              </div>
            </div>
            <!-- tool result -->
            <div v-else-if="m.role === 'tool'" class="bubble-row">
              <div class="bubble-ava" style="background:var(--grad-teal)"><v-icon name="tool" style="width:15px;height:15px"/></div>
              <div class="bubble tool"><b>{{ m.name }}</b> → {{ m.content }}</div>
            </div>
          </template>
          <empty-state v-if="!session.messages.length" icon="session" text="该对话暂无消息记录"/>
        </div>
      </div>
    </div>`,
  }
})()
