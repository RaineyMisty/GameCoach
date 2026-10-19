'use strict';

// Pure local memory data operations. No DOM, storage, network, or model calls.
window.GameCoachMemory = (() => {
  const tr = value => window.GameCoachI18n?.t(value) ?? value;
  const text = (value, max = 1000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const idOK = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
  const topics = ['general', 'support', 'jungle', 'carries', 'development', 'opponent', 'draft', 'review', 'player'];
  const roles = { top: '上单', jungle: '打野', mid: '中单', adc: '射手', support: '辅助' };
  const date = () => new Date().toISOString();
  const key = () => 'memory-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  function entry(raw) {
    if (!raw || !idOK(raw.id) || !text(raw.text)) return null;
    return { id: raw.id, title: text(raw.title, 80) || text(raw.text, 24), text: text(raw.text),
      topics: [...new Set((Array.isArray(raw.topics) ? raw.topics : ['general']).filter(topic => topics.includes(topic)))],
      kind: ['analysis', 'profile', 'personal'].includes(raw.kind) ? raw.kind : 'personal',
      source: ['builtin', 'profile', 'user', 'chat'].includes(raw.source) ? raw.source : 'user',
      field: ['rank', 'level', 'role', 'championPool', 'preferences'].includes(raw.field) ? raw.field : undefined,
      enabled: raw.enabled !== false, createdAt: text(raw.createdAt, 40), updatedAt: text(raw.updatedAt, 40) };
  }
  function seed() {
    const stamp = date();
    return { version: 1, enabled: true, entries: (window.GAMECOACH_MEMORY_DEFAULTS || []).map(item => entry({ ...item,
      kind: 'analysis', source: 'builtin', createdAt: stamp, updatedAt: stamp })) };
  }
  function normalize(raw, legacyProfile) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.entries)) return withProfile(seed(), legacyProfile);
    const seen = new Set();
    return { version: 1, enabled: raw.enabled !== false, entries: raw.entries.slice(0, 100).map(entry).filter(item => {
      if (!item || seen.has(item.id)) return false; seen.add(item.id); return true;
    }) };
  }
  function withProfile(raw, profile, previousProfile) {
    const memory = normalize(raw);
    const descriptions = {
      rank: ['段位', text(profile?.rank, 100)], level: ['自评水平', text(profile?.level)],
      role: ['常用位置', roles[profile?.role] || ''],
      championPool: ['熟悉的英雄', Array.isArray(profile?.championPool) ? [...new Set(profile.championPool.filter(value => typeof value === 'string').map(value => text(value, 80)).filter(Boolean))].join('、') : ''],
      preferences: ['个人偏好', text(profile?.preferences)],
    };
    for (const [field, [title, value]] of Object.entries(descriptions)) {
      if (previousProfile && JSON.stringify(profile?.[field]) === JSON.stringify(previousProfile[field])) continue;
      const id = 'profile-' + field, previous = memory.entries.find(item => item.id === id);
      if (!value) { memory.entries = memory.entries.filter(item => item.id !== id); continue; }
      const item = entry({ id, title, text: title + '：' + value + (field === 'role' ? '（不是本局已确认位置）' : field === 'championPool' ? '（不限制其他候选）' : ''),
        kind: 'profile', source: 'profile', field, topics: field === 'preferences' ? ['general'] : ['player'],
        enabled: previous?.enabled !== false, createdAt: previous?.createdAt || date(), updatedAt: date() });
      const at = memory.entries.findIndex(value => value.id === id);
      if (at < 0) memory.entries.push(item); else memory.entries[at] = item;
    }
    return normalize(memory);
  }
  function save(raw, patch) {
    const memory = normalize(raw), at = memory.entries.findIndex(item => item.id === patch.id), old = memory.entries[at];
    if (!text(patch.text)) throw new Error(tr('请填写记忆内容。'));
    if (at < 0 && memory.entries.length >= 100) throw new Error(tr('最多保存 100 条记忆，请先整理现有记忆。'));
    const item = entry({ ...old, ...patch, id: old?.id || key(), source: old?.source || patch.source || 'user',
      kind: old?.kind || 'personal', createdAt: old?.createdAt || date(), updatedAt: date() });
    if (at < 0) memory.entries.push(item); else memory.entries[at] = item;
    return memory;
  }
  function remove(raw, id) {
    const memory = normalize(raw); memory.entries = memory.entries.filter(item => item.id !== id); return memory;
  }
  function markdown(raw) {
    const memory = normalize(raw);
    return '# GameCoach memory\n\n' + tr(memory.enabled ? '记忆已启用。' : '记忆已暂停。')
      + tr('\n\n分析经验仅供相关问题参考；当前事实和本轮明确要求优先，不要求逐项回答。\n\n')
      + memory.entries.map(display).map(item => '## ' + item.title + tr('\n\n- 编号：') + item.id + tr('\n- 状态：') + tr(item.enabled ? '启用' : '暂停')
        + tr('\n- 场景：') + item.topics.join(', ') + tr('\n- 来源：') + item.source + '\n\n' + item.text).join('\n\n');
  }
  function display(item) {
    const seed = window.GAMECOACH_MEMORY_DEFAULTS?.find(value => value.id === item.id);
    const english = window.GAMECOACH_MEMORY_ENGLISH?.[item.id];
    const original = seed && item.title === seed.title && item.text === seed.text;
    const translated = english && item.title === english[0] && item.text === english[1];
    if (item.source === 'builtin' && english && (original || translated)) return { ...item,
      title: window.GameCoachI18n?.locale === 'en' ? english[0] : seed.title,
      text: window.GameCoachI18n?.locale === 'en' ? english[1] : seed.text };
    if (item.source === 'profile' && window.GameCoachI18n?.locale === 'en') {
      const labels = { role: '常用位置', rank: '段位', level: '自评水平', championPool: '熟悉的英雄', preferences: '个人偏好' };
      const label = labels[item.field];
      if (label && item.title === label && item.text.startsWith(label + '：')) {
        const suffix = item.field === 'role' ? '（不是本局已确认位置）' : item.field === 'championPool' ? '（不限制其他候选）' : '';
        let value = item.text.slice(label.length + 1);
        if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length);
        return { ...item, title: tr(label), text: tr(label) + ': ' + (item.field === 'role' ? tr(value) : value) + tr(suffix) };
      }
    }
    return { ...item };
  }
  return Object.freeze({ normalize, seed, withProfile, save, remove, markdown, display, topics: Object.freeze(topics) });
})();
