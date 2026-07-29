/** 视图:人设库(§2.2 · 内置只读 + 自定义) */
(function () {
  window.VIEWS = window.VIEWS || {}

  const AVA_BG = ['linear-gradient(135deg,#eef0fe,#e2e5fd)', 'linear-gradient(135deg,#e4f8f5,#d3f3ec)', 'linear-gradient(135deg,#fdf3e2,#fbe9c8)', 'linear-gradient(135deg,#fdecef,#fad9e0)', 'linear-gradient(135deg,#e8f6fe,#d3ecfc)']

  window.VIEWS.personas = {
    name: 'PersonasView',
    setup() {
      const { ref, computed, onMounted } = Vue
      const { toast, fmt } = window.UI
      const M = window.MOCK

      const personas = computed(() => M.personas)
      const detail = ref(null)
      const editor = ref({ show: false, idx: -1, form: null })

      const openCreate = () => {
        editor.value = { show: true, idx: -1, form: { id: '', name: '', description: '', tags: [], avatar: '🙂', greeting: '', systemPrompt: '', builtin: false, creator: '2854196310', createdAt: Date.now() } }
      }
      const openEdit = (p, i) => {
        if (p.builtin) { toast('内置人设为代码常量,只读不可改', 'warn'); return }
        editor.value = { show: true, idx: i, form: JSON.parse(JSON.stringify(p)) }
      }
      const tagInput = ref('')
      const addTag = () => {
        const f = editor.value.form
        const v = tagInput.value.trim()
        if (v && f.tags.length < 8 && !f.tags.includes(v)) f.tags.push(v)
        tagInput.value = ''
      }
      const applyEdit = async () => {
        const f = editor.value.form
        if (!f.name.trim() || !f.systemPrompt.trim()) { toast('名称与 systemPrompt 必填', 'warn'); return }
        const payload = JSON.parse(JSON.stringify(f))
        try {
          if (editor.value.idx === -1) {
            await window.api.post('/personas', payload)
            toast(`人设「${f.name}」已创建`)
          } else {
            await window.api.put(`/personas/${f.id}`, payload)
            toast(`人设「${f.name}」已更新`)
          }
          await window.store.loadPersonas()
          editor.value.show = false
        } catch (e) {
          const msg = e.message || ''
          if (/内置/.test(msg)) toast('内置人设只读', 'warn')
          else toast(msg, 'error')
        }
      }
      const del = async (p, i) => {
        if (p.builtin) { toast('内置人设不可删除', 'warn'); return }
        try {
          await window.api.del(`/personas/${p.id}`)
          await window.store.loadPersonas()
          toast(`已删除人设「${p.name}」`, 'info')
        } catch (e) {
          const msg = e.message || ''
          if (/内置/.test(msg)) toast('内置人设只读', 'warn')
          else toast(msg, 'error')
        }
      }

      onMounted(async () => { try { await window.store.loadPersonas() } catch (e) { toast(e.message, 'error') } })

      return { personas, detail, editor, openCreate, openEdit, tagInput, addTag, applyEdit, del, AVA_BG, fmt }
    },
    template: `
    <div>
      <div class="sec-head" style="--i:0">
        <div>
          <h3>人设库</h3>
          <div class="desc">data/personas/&lt;id&gt;.json · 内置为代码常量(builtin 只读),自定义可编辑</div>
        </div>
        <button class="btn btn-primary" @click="openCreate"><v-icon name="plus"/>新建人设</button>
      </div>

      <div class="grid grid-3 stagger">
        <div v-for="(p, i) in personas" :key="p.id" class="card hoverable persona-card" :style="{'--i': i + 1}" @click="detail = p">
          <div class="flex between">
            <div class="persona-ava" :style="{background: AVA_BG[i % AVA_BG.length]}">{{ p.avatar }}</div>
            <span v-if="p.builtin" class="chip chip-outline"><v-icon name="lock"/>内置</span>
            <span v-else class="chip chip-violet">自定义</span>
          </div>
          <div>
            <div style="font-weight:800;font-size:15px">{{ p.name }}</div>
            <div class="muted" style="font-size:12px;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">{{ p.description }}</div>
          </div>
          <div class="flex gap6 wrap">
            <span v-for="t in p.tags" :key="t" class="chip chip-primary" style="font-size:10.5px">{{ t }}</span>
          </div>
          <div class="flex between" style="margin-top:auto">
            <span class="muted-3" style="font-size:11px">{{ fmt.ago(p.createdAt) }}创建</span>
            <div class="flex gap6" @click.stop>
              <button class="icon-btn" @click="openEdit(p, i)" :title="p.builtin ? '内置只读' : '编辑'"><v-icon name="edit"/></button>
              <button class="icon-btn danger" @click="del(p, i)"><v-icon name="trash"/></button>
            </div>
          </div>
        </div>
      </div>

      <!-- 详情 -->
      <v-modal v-if="detail" :title="detail.name" icon="persona" width="720px" @close="detail = null">
        <div class="flex gap14" style="align-items:flex-start">
          <div class="persona-ava" style="width:64px;height:64px;font-size:32px;flex:0 0 64px" :style="{background: AVA_BG[0]}">{{ detail.avatar }}</div>
          <div style="flex:1">
            <div class="flex gap6 wrap">
              <span class="chip" :class="detail.builtin ? 'chip-outline' : 'chip-violet'">{{ detail.builtin ? '内置(代码常量)' : '自定义 .json' }}</span>
              <span v-for="t in detail.tags" :key="t" class="chip chip-primary">{{ t }}</span>
            </div>
            <p class="muted mt10" style="font-size:13px">{{ detail.description }}</p>
          </div>
        </div>
        <div class="divider"></div>
        <div class="field">
          <label class="field-label">开场白 greeting</label>
          <div class="bubble assistant" style="max-width:100%">{{ detail.greeting }}</div>
        </div>
        <div class="field mt16">
          <label class="field-label">systemPrompt</label>
          <pre class="code" style="white-space:pre-wrap">{{ detail.systemPrompt }}</pre>
        </div>
        <div class="muted-3 mt16" style="font-size:11.5px">id: <span class="mono">{{ detail.id }}</span> · creator: {{ detail.creator || '—' }} · {{ new Date(detail.createdAt).toLocaleString('zh-CN') }}</div>
      </v-modal>

      <!-- 编辑/新建 -->
      <v-modal v-if="editor.show" :title="editor.idx === -1 ? '新建人设' : '编辑人设 · ' + editor.form.name" icon="edit" width="720px" @close="editor.show = false">
        <div class="grid grid-2" style="gap:14px">
          <div class="field"><label class="field-label">名称</label><input class="input" v-model="editor.form.name"></div>
          <div class="field"><label class="field-label">头像 emoji</label><input class="input" v-model="editor.form.avatar" maxlength="4"></div>
          <div class="field" style="grid-column:1/-1"><label class="field-label">一句话描述</label><input class="input" v-model="editor.form.description"></div>
          <div class="field" style="grid-column:1/-1">
            <label class="field-label">标签(≤8,回车添加)</label>
            <div class="flex gap6 wrap">
              <span v-for="(t, i) in editor.form.tags" :key="t" class="chip chip-primary">{{ t }}<v-icon name="x" style="cursor:pointer" @click="editor.form.tags.splice(i, 1)"/></span>
              <input class="input" style="width:130px;padding:4px 9px;font-size:12px" v-model="tagInput" @keydown.enter.prevent="addTag" placeholder="回车添加">
            </div>
          </div>
          <div class="field" style="grid-column:1/-1"><label class="field-label">开场白</label><input class="input" v-model="editor.form.greeting"></div>
          <div class="field" style="grid-column:1/-1">
            <label class="field-label">systemPrompt</label>
            <textarea class="textarea" style="min-height:130px" v-model="editor.form.systemPrompt"></textarea>
          </div>
        </div>
        <template #foot>
          <button class="btn btn-ghost" @click="editor.show = false">取消</button>
          <button class="btn btn-primary" @click="applyEdit"><v-icon name="check"/>保存(模拟)</button>
        </template>
      </v-modal>
    </div>`,
  }
})()
