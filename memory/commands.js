'use strict';

// Explicit memory requests only. No extra model call or silent inference from a match story.
window.GameCoachMemoryCommands = (() => {
  function apply(raw, content) {
    const memory = window.GameCoachMemory.normalize(raw), value = content.trim();
    const remember = /^(?:请|帮我)?记住[：:,，\s]*(.{1,1000})$/s.exec(value);
    if (remember && !/[?？]/.test(remember[1])) {
      const text = remember[1].trim();
      if (/AIza[\w-]{20,}|\bAQ\.[\w.-]{20,}|\bsk-[\w-]{20,}/.test(text)) return { handled: true, memory, notice: '请不要把 API Key 保存为记忆。' };
      const duplicate = memory.entries.find(item => item.text === text);
      if (duplicate) return { handled: true, memory, notice: '这条记忆已经保存。可在“管理记忆”中修改或启用。' };
      const personal = /常用位置|常玩|常用英雄|英雄池|(?:喜欢|主要|通常|经常).*(?:玩|打|走).*(?:辅助|打野|上单|中单|射手)/.test(text);
      const topics = personal ? ['player'] : /辅助/.test(text) ? ['support'] : /打野|半区|野区/.test(text) ? ['jungle'] : ['general'];
      const next = window.GameCoachMemory.save(memory, { title: text.slice(0, 24), text, source: 'chat', topics });
      return { handled: true, memory: next, notice: '已保存为本地记忆：' + text + '\n\n以后会在相关问题中参考，可在“管理记忆”中修改、暂停或删除。' };
    }
    const forget = /^(?:请|帮我)?(?:忘记|忘掉)[：:,，\s]+(.{1,1000})$/s.exec(value);
    if (forget) {
      const term = forget[1].trim(), exact = memory.entries.find(item => item.id === term);
      const matches = exact ? [exact] : memory.entries.filter(item => item.title.includes(term) || item.text.includes(term));
      if (matches.length !== 1) return { handled: true, memory, notice: matches.length ? '匹配到多条记忆，请在“管理记忆”中选择，或使用准确编号。' : '没有找到对应记忆。可在“管理记忆”中查看编号。' };
      return { handled: true, memory: window.GameCoachMemory.remove(memory, matches[0].id), notice: '已删除本地记忆：' + matches[0].title + '。以前聊天中的原文仍保留。' };
    }
    return { handled: false, memory };
  }
  return Object.freeze({ apply });
})();
