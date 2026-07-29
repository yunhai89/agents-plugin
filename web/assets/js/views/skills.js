/** 视图:技能(§2.3 · skills/*.md frontmatter + 正文) */
(function () {
  window.VIEWS = window.VIEWS || {}

  window.VIEWS.skills = {
    name: 'SkillsView',
    setup() {
      const { ref, onMounted } = Vue
      const detail = ref(null)
      const q = ref('')
      const filtered = () => window.MOCK.skills.filter((s) =>
        !q.value || s.name.includes(q.value) || s.description.includes(q.value) || s.when.keywords.some((k) => k.includes(q.value)))
      onMounted(async () => { try { await window.store.loadSkills() } catch { /* 忽略 */ } })
      return { skills: window.MOCK.skills, detail, q, filtered }
    },
    template: `
    <div>
      <div class="sec-head" style="--i:0">
        <div>
          <h3>技能</h3>
          <div class="desc">skills/*.md · YAML frontmatter 描述触发条件,正文为使用说明;always=true 常驻注入</div>
        </div>
        <input class="input" style="width:230px" v-model="q" placeholder="搜索名称 / 关键词…">
      </div>

      <div class="card" style="--i:1;overflow:hidden">
        <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th style="width:220px">技能</th><th>描述</th><th style="width:90px">优先级</th><th style="width:90px">常驻</th><th style="width:220px">触发关键词</th></tr></thead>
          <tbody>
            <tr v-for="(s, i) in filtered()" :key="s.name" @click="detail = s" style="cursor:pointer">
              <td><span class="mono" style="font-weight:800;color:var(--primary)">{{ s.name }}</span></td>
              <td class="muted ellipsis" style="max-width:300px">{{ s.description }}</td>
              <td><span class="chip" :class="s.priority >= 15 ? 'chip-amber' : 'chip-outline'">P{{ s.priority }}</span></td>
              <td><span class="chip" :class="s.when.always ? 'chip-green' : ''">{{ s.when.always ? 'always' : '按需' }}</span></td>
              <td>
                <div class="flex gap6 wrap">
                  <span v-for="k in s.when.keywords" :key="k" class="chip chip-sky" style="font-size:10.5px">{{ k }}</span>
                  <span v-for="r in s.when.regex" :key="r" class="chip chip-violet mono" style="font-size:10.5px">{{ r }}</span>
                  <span v-if="!s.when.keywords.length && !s.when.regex.length" class="muted-3" style="font-size:11.5px">—</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <empty-state v-if="!filtered().length" icon="search" text="没有匹配的技能"/>
      </div>

      <!-- 详情 -->
      <v-modal v-if="detail" :title="detail.name" icon="skill" width="720px" @close="detail = null">
        <div class="flex gap6 wrap">
          <span class="chip chip-amber">P{{ detail.priority }}</span>
          <span class="chip" :class="detail.when.always ? 'chip-green' : 'chip-outline'">{{ detail.when.always ? 'always 常驻' : '按需触发' }}</span>
          <span v-for="k in detail.when.keywords" :key="k" class="chip chip-sky">{{ k }}</span>
        </div>
        <p class="muted mt10" style="font-size:13px">{{ detail.description }}</p>
        <div class="divider"></div>
        <div class="field">
          <label class="field-label">frontmatter</label>
          <pre class="code">---
name: {{ detail.name }}
description: "{{ detail.description }}"
when: [{{ detail.when.keywords.join(', ') }}]
priority: {{ detail.priority }}
always: {{ detail.when.always }}
---</pre>
        </div>
        <div class="field mt16">
          <label class="field-label">正文(markdown)</label>
          <pre class="code" style="white-space:pre-wrap">{{ detail.body }}</pre>
        </div>
      </v-modal>
    </div>`,
  }
})()
