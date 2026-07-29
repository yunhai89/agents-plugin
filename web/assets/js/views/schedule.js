/** 视图:定时任务(§3.4 · 单键全量数组) */
(function () {
  window.VIEWS = window.VIEWS || {}

  window.VIEWS.schedule = {
    name: 'ScheduleView',
    setup() {
      const { ref, computed, onMounted, onUnmounted } = Vue
      const { toast, fmt } = window.UI
      const M = window.MOCK

      /* 每秒刷新倒计时 */
      const tick = ref(0)
      const timer = setInterval(() => tick.value++, 1000)

      const jobs = computed(() => (M.schedules || []).slice().sort((a, b) => a.at - b.at))
      /* 读 tick 建立依赖,模板每秒钟级刷新倒计时文本 */
      const until = (ts) => { void tick.value; return fmt.until(ts) }
      const del = async (j) => {
        try {
          await window.api.del(`/schedule/${j.id}`)
          await window.store.loadSchedule()
          toast('已取消该定时任务', 'info')
        } catch (e) { toast(e.message, 'error') }
      }

      const addModal = ref({ show: false, message: '', groupId: '', inHours: 2 })
      const add = async () => {
        const m = addModal.value
        if (!m.message.trim()) { toast('请填写提醒内容', 'warn'); return }
        try {
          await window.api.post('/schedule', {
            userId: '2854196310', groupId: m.groupId || null,
            message: m.message.trim(), at: Date.now() + m.inHours * 3600e3,
          })
          await window.store.loadSchedule()
          toast('定时任务已创建')
          addModal.value.show = false
          addModal.value.message = ''
        } catch (e) { toast(e.message, 'error') }
      }

      onMounted(async () => { try { await window.store.loadSchedule() } catch (e) { toast(e.message, 'error') } })
      onUnmounted(() => clearInterval(timer))

      return { jobs, tick, until, del, addModal, add, fmt }
    },
    template: `
    <div>
      <div class="sec-head" style="--i:0">
        <div>
          <h3>定时任务</h3>
          <div class="desc">键 Yz:agent:rem:jobs · 单键全量数组 · 到点由 bot(selfId) 向群/私聊投递提醒</div>
        </div>
        <button class="btn btn-primary" @click="addModal.show = true"><v-icon name="plus"/>新建提醒</button>
      </div>

      <div class="grid grid-3 stagger">
        <div v-for="(j, i) in jobs" :key="j.id" class="card hoverable card-pad" :style="{'--i': i + 1}">
          <div class="flex between">
            <span class="chip" :class="j.groupId ? 'chip-sky' : 'chip-violet'">
              <v-icon :name="j.groupId ? 'group' : 'user'"/>{{ j.groupId ? '群 ' + j.groupId : '私聊' }}
            </span>
            <button class="icon-btn danger" @click="del(j)"><v-icon name="trash"/></button>
          </div>
          <p class="mt10" style="font-size:13.5px;font-weight:600;line-height:1.7;min-height:44px">{{ j.message }}</p>
          <div class="divider" style="margin:12px 0"></div>
          <div class="flex between">
            <div>
              <div style="font-weight:800;font-size:15px;color:var(--primary)" class="num">{{ until(j.at) }}</div>
              <div class="muted-3" style="font-size:11px">{{ new Date(j.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }} 触发</div>
            </div>
            <div class="muted-3" style="font-size:11px;text-align:right">
              <div>bot {{ j.selfId }}</div>
              <div class="mono">{{ j.id }}</div>
            </div>
          </div>
        </div>
      </div>
      <empty-state v-if="!jobs.length" icon="schedule" text="暂无定时任务"/>

      <!-- 新建 -->
      <v-modal v-if="addModal.show" title="新建定时提醒(模拟)" icon="plus" @close="addModal.show = false">
        <div class="grid grid-2" style="gap:14px">
          <div class="field" style="grid-column:1/-1">
            <label class="field-label">提醒内容</label>
            <textarea class="textarea" v-model="addModal.message" placeholder="例如:提醒开黑前重启测试服 bot"></textarea>
          </div>
          <div class="field">
            <label class="field-label">目标群(留空=私聊)</label>
            <input class="input" v-model="addModal.groupId" placeholder="群号,如 960179589">
          </div>
          <div class="field">
            <label class="field-label">N 小时后触发</label>
            <input type="number" class="input" min="1" v-model.number="addModal.inHours">
          </div>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="addModal.show = false">取消</button>
          <button class="btn btn-primary" @click="add"><v-icon name="check"/>创建(模拟)</button>
        </template>
      </v-modal>
    </div>`,
  }
})()
