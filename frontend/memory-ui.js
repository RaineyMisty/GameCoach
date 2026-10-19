'use strict';

window.GameCoachMemoryUI = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  function create({ store, onChange }) {
    const $ = selector => document.querySelector(selector), form = $('#memory-form');
    const names = { general: '一般分析', support: '辅助选人', jungle: '打野决策', carries: '中下双 C', development: '阵容发展', opponent: '对手应对', draft: '阵容与选人', review: '战报与复盘', player: '个人经验' };
    let editing = null, undo = null, undoUser = null;
    function node(tag, className, value) {
      const item = document.createElement(tag); if (className) item.className = className;
      if (value !== undefined) item.textContent = value; return item;
    }
    function button(label, action) { const control = node('button', 'text-button', label); control.type = 'button'; control.onclick = action; return control; }
    function commit(memory, message) {
      store.current().memory = window.GameCoachMemory.normalize(memory);
      const saved = store.persist(); $('#memory-status').textContent = message + (saved ? '' : tr(" 当前页面生效，请导出备份或连接本地文件夹以保存。"));
      render(); onChange();
    }
    function reset() { editing = null; form.reset(); $('#memory-save').textContent = tr("添加记忆"); $('#memory-cancel').hidden = true; }
    function render() {
      const memory = store.current().memory; $('#memory-enabled').checked = memory.enabled;
      $('#memory-count').textContent = memory.entries.filter(item => item.enabled).length + tr(" 条启用 / ") + memory.entries.length + tr(" 条已保存");
      $('#memory-undo').hidden = !undo || undoUser !== store.current().id;
      const list = $('#memory-list'); list.replaceChildren();
      for (const item of memory.entries) {
        const view = window.GameCoachMemory.display(item);
        const card = node('article', 'memory-card'); card.dataset.memoryId = item.id;
        const heading = node('div', 'memory-card-heading'), label = node('label', 'memory-entry-toggle');
        const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = item.enabled;
        toggle.setAttribute('aria-label', tr("启用记忆：") + view.title);
        toggle.onchange = () => commit(window.GameCoachMemory.save(memory, { ...item, enabled: toggle.checked }), toggle.checked ? tr("已启用这条记忆。") : tr("已暂停这条记忆。"));
        label.append(toggle, node('strong', '', view.title)); heading.append(label);
        const actions = node('div', 'memory-card-actions');
        actions.append(button(tr("编辑"), () => {
          editing = item.id; form.elements.title.value = view.title; form.elements.text.value = view.text;
          form.elements.topic.value = item.topics[0] || 'general'; $('#memory-save').textContent = tr("保存修改"); $('#memory-cancel').hidden = false;
          form.elements.text.focus();
        }), button(tr("删除"), () => {
          undo = structuredClone(item); undoUser = store.current().id;
          if (editing === item.id) reset();
          commit(window.GameCoachMemory.remove(memory, item.id), tr("已删除，可撤销这次删除。"));
        }));
        heading.append(actions); card.append(heading, node('p', 'memory-card-text', view.text),
          node('small', 'memory-card-meta', (item.source === 'builtin' ? tr("初始分析经验") : item.source === 'profile' ? tr("玩家资料记忆") : item.source === 'chat' ? tr("聊天中明确保存") : tr("手动记忆"))
            + ' · ' + item.topics.map(topic => tr(names[topic])).join(' / ') + ' · ' + item.id)); list.append(card);
      }
      if (!memory.entries.length) list.append(node('p', 'subtle', tr("还没有记忆。添加一条希望长期保留的分析经验或偏好。")));
    }
    $('#memory-enabled').onchange = event => commit({ ...store.current().memory, enabled: event.target.checked }, event.target.checked ? tr("已启用记忆。") : tr("已暂停记忆，后续请求不再接入；以前聊天中的原文不会因此删除。"));
    form.onsubmit = event => {
      event.preventDefault(); const previous = store.current().memory.entries.find(item => item.id === editing);
      try {
        commit(window.GameCoachMemory.save(store.current().memory, { id: editing, title: form.elements.title.value, text: form.elements.text.value,
          topics: previous?.topics[0] === form.elements.topic.value ? previous.topics : [form.elements.topic.value] }), tr("记忆已保存，后续相关问题会参考。")); reset();
      } catch (error) { $('#memory-status').textContent = error.message; }
    };
    $('#memory-cancel').onclick = reset;
    $('#memory-undo').onclick = () => {
      if (!undo || undoUser !== store.current().id) return;
      const memory = window.GameCoachMemory.normalize(store.current().memory);
      if (!memory.entries.some(item => item.id === undo.id) && memory.entries.length < 100) memory.entries.push(undo);
      undo = null; commit(memory, tr("已恢复删除的记忆。"));
    };
    $('#memory-export').onclick = () => {
      const url = URL.createObjectURL(new Blob([window.GameCoachMemory.markdown(store.current().memory)], { type: 'text/markdown;charset=utf-8' }));
      const link = node('a'); link.href = url; link.download = 'gamecoach-memory-' + store.current().id + '.md';
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    window.addEventListener('gamecoach:language-changed', () => {
      render(); $('#memory-save').textContent = editing ? tr('保存修改') : tr('添加记忆'); $('#memory-status').textContent = '';
    });
    return { open() {
      if (undoUser !== store.current().id) undo = null;
      reset(); render(); $('#memory-status').textContent = ''; $('#memory-dialog').showModal();
    } };
  }
  return Object.freeze({ create });
})();
