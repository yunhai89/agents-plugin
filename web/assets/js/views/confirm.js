/** 视图:审批门(§3.5 · 纯内存,重启清空) */
(function () {
  window.VIEWS = window.VIEWS || {}

  window.VIEWS.confirm = {
    name: 'ConfirmView',
    setup() {
      const { ref, computed, onMounted, onUnmounted } = Vue
      const { toast, fmt } = window.UI
      const M = window.MOCK
      /* confirmTimeout 来自 config;未加载时取默认 300s */
      const TIMEOUT = computed(() => (M.config?.confirmTimeout || 300) * 1000)

      /* 直接读 MOCK.confirms:侧边栏徽标/概览计数联动更新 */
      const items = computed(() => M.confirms)
      const tick = ref(0)
      const timer = setInterval(() => tick.value++, 1000)
      let pollTimer = null

      /* 读 tick 建立依赖,倒计时环每秒刷新 */
      const remain = (c) => { void tick.value; return Math.max(0, TIMEOUT.value - (Date.now() - c.createdAt)) }
      const remainPct = (c) => (remain(c) / TIMEOUT.value) * 100
      const ringOffset = (c) => 2 * Math.PI * 19 * (1 - remainPct(c) / 100)

      const decide = async (c, ok) => {
        try {
          await window.api.post(`/confirm/${c.id}/decide`, { approve: ok })
          await window.store.loadConfirm()
          toast(ok ? `已批准 ${c.tool}(不真正执行)` : `已拒绝 ${c.tool}`, ok ? 'success' : 'info')
        } catch (e) { toast(e.message, 'error') }
      }

      const danger = (tool) => ['terminal', 'send_like'].includes(tool)

      /* 惰性加载:config(取 confirmTimeout)+ 队列;5s 轮询(后端管超时淘汰) */
      onMounted(async () => {
        try { await window.store.loadConfig() } catch { /* 忽略 */ }
        try { await window.store.loadConfirm() } catch (e) { toast(e.message, 'error') }
        pollTimer = setInterval(() => window.store.loadConfirm().catch(() => {}), 5000)
      })
      onUnmounted(() => { clearInterval(timer); if (pollTimer) clearInterval(pollTimer) })

      return { items, tick, remain, remainPct, ringOffset, decide, danger, fmt, TIMEOUT }
    },
    template: `
    <div>
      <div class="card card-pad flex between wrap gap14" style="--i:0">
        <div>
          <div class="card-title"><v-icon name="confirm"/>待审批队列</div>
          <div class="card-sub">纯内存,不持久化,重启清空 · 超时({{ TIMEOUT / 1000 }}s)自动拒绝 · 模拟环境不会真正执行</div>
        </div>
        <span class="chip" :class="items.length ? 'chip-amber' : 'chip-green'" style="font-size:13px;padding:6px 14px">
          {{ items.length ? items.length + ' 条待审批' : '队列已清空' }}
        </span>
      </div>

      <TransitionGroup name="list" tag="div" class="grid grid-2 mt16" style="position:relative">
        <div v-for="(c, i) in items" :key="c.id" class="card confirm-card hoverable" :style="{'--i': i}">
          <div class="flex gap14" style="align-items:flex-start">
            <!-- 倒计时环 -->
            <div class="countdown-ring">
              <svg width="46" height="46">
                <circle cx="23" cy="23" r="19" fill="none" stroke="var(--surface-3)" stroke-width="5"/>
                <circle cx="23" cy="23" r="19" fill="none" stroke-linecap="round" stroke-width="5"
                  :stroke="remainPct(c) > 40 ? 'var(--teal)' : 'var(--rose)'"
                  :stroke-dasharray="2 * Math.PI * 19" :stroke-dashoffset="ringOffset(c)"
                  style="transition:stroke-dashoffset 1s linear, stroke .5s"/>
              </svg>
              <div class="countdown-num num">{{ Math.ceil(remain(c) / 1000) }}</div>
            </div>
            <div style="flex:1;min-width:0">
              <div class="flex gap6 wrap">
                <span class="chip" :class="danger(c.tool) ? 'chip-rose' : 'chip-sky'"><v-icon :name="danger(c.tool) ? 'warn' : 'tool'"/>{{ c.tool }}</span>
                <span class="chip chip-outline mono">#{{ c.id }}</span>
              </div>
              <div class="muted mt10" style="font-size:12px">
                申请人 <b class="mono">{{ c.ctx.user }}</b> · {{ c.ctx.gid ? '群 ' + c.ctx.gid : '私聊' }} · {{ fmt.ago(c.createdAt) }}发起
              </div>
              <div class="muted" style="font-size:12px;margin-top:2px">事由:{{ c.ctx.reason }}</div>
            </div>
          </div>
          <div class="mt10"><json-block :data="c.args"/></div>
          <div class="flex gap10 mt10" style="justify-content:flex-end">
            <button class="btn btn-danger-soft" @click="decide(c, false)"><v-icon name="x"/>拒绝</button>
            <button class="btn btn-success" @click="decide(c, true)"><v-icon name="check"/>批准执行</button>
          </div>
        </div>
      </TransitionGroup>
      <empty-state v-if="!items.length" icon="confirm" text="暂无待审批项" sub="高危工具(terminal 写命令等)发起时会出现在这里"/>
    </div>`,
  }
})()
