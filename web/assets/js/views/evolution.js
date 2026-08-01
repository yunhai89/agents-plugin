/** 视图:工具进化(Tool Evolution)· 候选版本/状态/审批/淘汰 */
;(function () {
  window.VIEWS = window.VIEWS || {}
  const STATUS = { draft: '⚪ 草稿', verified: '🟡 待采纳', stable: '🟢 已上线', rejected: '⚫ 已拒绝', deprecated: '⚰ 已淘汰', quarantined: '🚫 隔离' }

  window.VIEWS.evolution = {
    name: 'EvolutionView',
    setup() {
      const { ref, computed, onMounted } = Vue
      const { toast } = window.UI

      const list = ref([])
      const loading = ref(false)
      const filter = ref('')

      const load = async () => {
        loading.value = true
        try { list.value = await window.api.get('/tevo/tools') }
        catch (e) { toast(e.message, 'error') }
        finally { loading.value = false }
      }
      const approve = async (id) => {
        try { await window.api.post('/tevo/tools/' + id + '/approve'); toast('已采纳并注入，agent 可调用', 'success'); await load() }
        catch (e) { toast(e.message, 'error') }
      }
      const decommission = async (id) => {
        try { await window.api.post('/tevo/tools/' + id + '/decommission'); toast('已淘汰', 'info'); await load() }
        catch (e) { toast(e.message, 'error') }
      }
      const rollback = async (id) => {
        try { const r = await window.api.post('/tevo/tools/' + id + '/rollback'); toast(r.msg || '已设为当前上线版本', 'success'); await load() }
        catch (e) { toast(e.message, 'error') }
      }

      const stats = computed(() => {
        const c = { draft: 0, verified: 0, stable: 0, rejected: 0, deprecated: 0 }
        for (const v of list.value) c[v.status] = (c[v.status] || 0) + 1
        return c
      })
      const filtered = computed(() => filter.value ? list.value.filter((v) => v.status === filter.value) : list.value)

      onMounted(load)
      return { list, loading, filter, filtered, stats, load, approve, decommission, rollback, STATUS }
    },
    template: `
    <div class="card card-pad">
      <div class="flex between mb16">
        <div><div class="card-title"><v-icon name="tool"/> 工具进化</div><div class="card-sub">Tool Evolution · 候选生成(LLM+AST)→验证(沙箱)→审批→版本</div></div>
        <button class="btn btn-ghost btn-sm" @click="load"><v-icon name="refresh"/>刷新</button>
      </div>

      <div class="flex gap6 wrap mb16">
        <button class="chip" :class="{active: filter===''}" @click="filter=''">全部 {{list.length}}</button>
        <button class="chip" :class="{active: filter==='verified'}" @click="filter='verified'">🟡待采纳 {{stats.verified||0}}</button>
        <button class="chip" :class="{active: filter==='stable'}" @click="filter='stable'">🟢已上线 {{stats.stable||0}}</button>
        <button class="chip" :class="{active: filter==='rejected'}" @click="filter='rejected'">⚫已拒绝 {{stats.rejected||0}}</button>
      </div>

      <empty-state v-if="!filtered.length && !loading" icon="tool" text="暂无进化工具版本。在 QQ 对 bot 发 #进化工具 <能力描述> 生成候选"/>

      <div v-for="v in filtered" :key="v.id" class="cfg-item" style="margin-bottom:10px">
        <div class="flex between wrap gap6">
          <div style="min-width:0">
            <b>{{ STATUS[v.status] || v.status }}</b>
            <span class="mono muted" style="margin-left:8px">v{{ v.semver }}</span>
            <span class="mono muted-3" style="font-size:10.5px;margin-left:8px">{{ v.id }}</span>
          </div>
          <div class="flex gap6">
            <button v-if="v.status==='verified'" class="btn btn-primary btn-sm" @click="approve(v.id)"><v-icon name="check"/>采纳上线</button>
            <button v-if="v.status==='stable'" class="btn btn-ghost btn-sm" @click="rollback(v.id)"><v-icon name="undo"/>设为当前</button>
            <button v-if="v.status==='stable'" class="btn btn-ghost btn-sm" @click="decommission(v.id)">淘汰</button>
          </div>
        </div>
        <div class="muted-3 mono ellipsis" style="font-size:10.5px;margin-top:4px">tool_id: {{ v.tool_id }} · 生成模型: {{ v.generator_model || '—' }}</div>
      </div>
    </div>`,
  }
})()
