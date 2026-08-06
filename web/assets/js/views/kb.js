/** 视图:知识库（全局共享文档库，chunk+embedding RAG；支持网页 URL 入库 + 定时刷新） */
;(function () {
  window.VIEWS = window.VIEWS || {}
  window.VIEWS.kb = {
    name: 'KbView',
    setup() {
      const { ref, onMounted } = Vue
      const M = window.MOCK
      const title = ref('')
      const text = ref('')
      const url = ref('')
      const urlTitle = ref('')
      const busy = ref(false)
      const msg = ref('')
      const reload = async () => { try { await window.store.loadKb() } catch { /* noop */ } }
      onMounted(reload)
      const add = async () => {
        if (!text.value.trim()) { msg.value = '请粘贴要入库的文本'; return }
        busy.value = true; msg.value = '入库中（分块 + 向量化）…'
        try {
          const r = await window.api.post('/kb', { title: title.value.trim(), text: text.value })
          msg.value = `✓ 已入库 ${r.id}：${r.chunkCount} 块${r.embedded ? '（已向量化）' : '（未配 embedding，关键词检索）'}`
          title.value = ''; text.value = ''; await reload()
        } catch (e) { msg.value = '入库失败：' + (e?.message || e) }
        finally { busy.value = false }
      }
      const addUrl = async () => {
        if (!url.value.trim()) { msg.value = '请输入网址'; return }
        busy.value = true; msg.value = '抓取入库中（可能需数秒）…'
        try {
          const r = await window.api.post('/kb/url', { url: url.value.trim(), title: urlTitle.value.trim() })
          msg.value = `✓ 已抓取入库 ${r.id}：${r.title}（${r.chunkCount} 块，via ${r.via}）`
          url.value = ''; urlTitle.value = ''; await reload()
        } catch (e) { msg.value = '抓取入库失败：' + (e?.message || e) }
        finally { busy.value = false }
      }
      const refreshDoc = async (id) => {
        busy.value = true; msg.value = `刷新中（${id}）…`
        try {
          const r = await window.api.post('/kb/' + id + '/refresh', {})
          msg.value = `✓ 已刷新 ${id}：${r.chunkCount} 块（via ${r.via}）`; await reload()
        } catch (e) { msg.value = '刷新失败：' + (e?.message || e) }
        finally { busy.value = false }
      }
      const remove = async (id) => {
        if (!confirm(`删除文档 ${id}？`)) return
        try { await window.api.del('/kb/' + id); msg.value = '已删除'; await reload() }
        catch (e) { msg.value = '删除失败：' + (e?.message || e) }
      }
      const rebuild = async () => {
        busy.value = true; msg.value = '重建索引中…'
        try { const r = await window.api.post('/kb/rebuild', {}); msg.value = `✓ 重建 ${r.rebuilt} 块` }
        catch (e) { msg.value = '重建失败：' + (e?.message || e) }
        finally { busy.value = false; await reload() }
      }
      const dateStr = (t) => t ? new Date(t).toLocaleString('zh-CN') : ''
      return { docs: M.kb, title, text, url, urlTitle, busy, msg, add, addUrl, refreshDoc, remove, rebuild, dateStr }
    },
    template: `
    <div>
      <div class="sec-head" style="--i:0">
        <div>
          <h3>知识库</h3>
          <div class="desc">全局共享文档库 · chunk + embedding 向量化 · 对话时 Agent 调 kb_search 检索（RAG）。支持网页 URL 入库 + 定时拉取最新。embedding 复用 recall.embedProvider。</div>
        </div>
        <button class="btn" @click="rebuild" :disabled="busy">🔄 重建索引</button>
      </div>

      <div class="card card-pad" style="--i:1">
        <div class="card-title mb10">添加网页 URL（自动抓取正文入库）</div>
        <input class="input" style="width:100%;margin-bottom:8px" v-model="url" placeholder="https://example.com/article（自动抓取正文 → 分块入库）">
        <input class="input" style="width:100%;margin-bottom:8px" v-model="urlTitle" placeholder="标题（可选，留空用页面标题）">
        <div class="flex between">
          <span class="muted-3" style="font-size:12px">入库后可用 #知识库定时 &lt;id&gt; 每天8点 设定时刷新最新内容</span>
          <button class="btn btn-primary" @click="addUrl" :disabled="busy">🌐 抓取入库</button>
        </div>
      </div>

      <div class="card card-pad" style="--i:2">
        <div class="card-title mb10">添加文档（粘贴文本）</div>
        <input class="input" style="width:100%;margin-bottom:8px" v-model="title" placeholder="标题（可选，留空自动命名）">
        <textarea class="input mono" style="width:100%;height:140px;margin-bottom:8px;resize:vertical" v-model="text" placeholder="粘贴文档全文（FAQ / 资料 / 设定等）。长文会自动分块向量化。"></textarea>
        <div class="flex between">
          <span class="muted-3" style="font-size:12px">{{ msg }}</span>
          <button class="btn btn-primary" @click="add" :disabled="busy">入库</button>
        </div>
      </div>

      <div class="card" style="--i:3;overflow:hidden">
        <div class="card-title" style="padding:15px 20px">已入库文档（{{ docs.length }} · 🌐网页 / 📄文本）</div>
        <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>标题</th><th style="width:120px">ID</th><th style="width:60px">分块</th><th style="width:150px">定时 / 刷新</th><th style="width:120px">操作</th></tr></thead>
          <tbody>
            <tr v-for="d in docs" :key="d.id">
              <td>
                <span :class="d.url ? '' : ''">{{ d.url ? '🌐' : '📄' }}</span> {{ d.title }}
                <div v-if="d.url" class="muted-3" style="font-size:11px;word-break:break-all">{{ d.url }}</div>
              </td>
              <td class="mono muted" style="font-size:11px">{{ d.id }}</td>
              <td><span class="chip">{{ d.chunkCount }}</span></td>
              <td class="muted" style="font-size:11px">
                <span v-if="d.refreshCron">⏰ {{ d.refreshCron }}</span>
                <span v-else class="muted-3">—</span>
                <div v-if="d.lastCrawled" class="muted-3">刷新 {{ dateStr(d.lastCrawled) }}</div>
                <div class="muted-3">入库 {{ dateStr(d.createdAt) }}</div>
              </td>
              <td>
                <button v-if="d.url" class="btn btn-sm" @click="refreshDoc(d.id)" :disabled="busy" title="刷新最新内容">🔄</button>
                <button class="btn btn-sm" @click="remove(d.id)" title="删除">🗑</button>
              </td>
            </tr>
            <tr v-if="!docs.length"><td colspan="5" class="muted-3" style="text-align:center;padding:24px">暂无文档（上方粘贴文本或添加 URL，或 #知识库添加 命令）</td></tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>`,
  }
})()
