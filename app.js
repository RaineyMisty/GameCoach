'use strict';
// Everything in this demo runs in the browser. No API keys or server required.
const $ = selector => document.querySelector(selector);
const data = window.GAMECOACH_DATA;
const defaults = () => ({ rank: '', level: '', role: 'support', championPool: [], preferences: '' });
const storageKey = 'gamecoach-static-v1';
let memory = { profile: defaults(), analyses: [] };
let storageAvailable = true;
function storageNotice() {
  $('#profile-status').textContent = '浏览器存储不可用：数据仅在当前页面保留，可使用导出备份。';
}
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return defaults();
  const clean = defaults();
  for (const key of ['rank', 'level', 'role', 'preferences']) {
    if (typeof p[key] === 'string') clean[key] = p[key].slice(0, 1000);
  }
  if (Array.isArray(p.championPool)) clean.championPool = p.championPool.filter(x => typeof x === 'string').slice(0, 100).map(x => x.slice(0, 80));
  return clean;
}
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  if (saved && typeof saved === 'object') {
    memory.profile = cleanProfile(saved.profile);
    if (Array.isArray(saved.analyses)) memory.analyses = saved.analyses.slice(-100);
  }
} catch {
  storageAvailable = false;
  storageNotice();
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(memory));
    storageAvailable = true;
    return true;
  } catch {
    storageAvailable = false;
    storageNotice();
    return false;
  }
}
const state = { mode: 'quick', target: 'ally', ally: [], enemy: [] };
function button(text, callback) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = text; b.onclick = callback;
  return b;
}
function render() {
  for (const side of ['ally', 'enemy']) {
    const area = $('#' + side); area.replaceChildren();
    for (const id of state[side]) {
      area.append(button(data.champions.find(c => c.id === id).name, () => {
        state[side] = state[side].filter(x => x !== id); draftChanged();
      }));
    }
    for (let i = state[side].length; i < 5; i++) {
      const slot = document.createElement('span'); slot.textContent = '＋'; area.append(slot);
    }
  }
  const pool = $('#champions'); pool.replaceChildren();
  const query = $('#search').value.trim().toLowerCase();
  for (const c of data.champions.filter(c => (c.id + c.name).toLowerCase().includes(query))) {
    const b = button('', () => {
      if (state[state.target].length < 5 && !state.ally.includes(c.id) && !state.enemy.includes(c.id)) {
        state[state.target].push(c.id); draftChanged();
      }
    });
    b.disabled = state.ally.includes(c.id) || state.enemy.includes(c.id) || state[state.target].length >= 5;
    b.title = c.name;
    const img = document.createElement('img'); img.src = c.portrait; img.alt = c.name;
    const label = document.createElement('span'); label.textContent = c.name;
    b.append(img, label); pool.append(b);
  }
  if (!pool.childElementCount) {
    const p = document.createElement('p'); p.textContent = '没有找到匹配的演示英雄。'; pool.append(p);
  }
}
function draftChanged() {
  $('#result').textContent = '阵容已更新，点击“分析阵容”查看演示结果。';
  render();
}
function mode(value) {
  state.mode = value;
  for (const m of ['quick', 'coach']) $('#' + m).setAttribute('aria-pressed', String(value === m));
  $('#question-label').firstChild.textContent = value === 'quick' ? '当前问题' : '复盘、追问或策略讨论';
}
for (const m of ['quick', 'coach']) $('#' + m).onclick = () => mode(m);
for (const side of ['ally', 'enemy']) $('#' + side + '-target').onclick = () => {
  state.target = side;
  for (const s of ['ally', 'enemy']) $('#' + s + '-target').setAttribute('aria-pressed', String(s === side));
  render();
};
$('#search').oninput = render;
$('#reset').onclick = () => { state.ally = []; state.enemy = []; draftChanged(); };
const dimensions = [
  { id: 'engage', label: '开团能力', weight: .20 },
  { id: 'protection', label: '保护能力', weight: .25 },
  { id: 'damage', label: '伤害覆盖', weight: .20 },
  { id: 'frontline', label: '前排能力', weight: .20 },
  { id: 'tempo', label: '节奏配合', weight: .15 },
];
function run() {
  $('#error').textContent = '';
  const question = $('#question').value.trim();
  if (question.length > 4000) { $('#error').textContent = '问题请控制在 4000 字以内。'; return; }
  const complete = state.ally.length === 5 && state.enemy.length === 5;
  const result = {
    summary: state.mode === 'quick'
      ? '演示：优先检查前排、控制和保护是否完整。当前未接入真实 AI。'
      : '演示：深入模式将用于讨论阵容配合、玩家偏好与替代方案。当前未接入真实 AI，不会对输入问题进行实际推理。',
    recommendations: ['演示：根据英雄池选择熟悉的英雄。', '演示：完整阵容后再讨论团队配合。'],
    scoring: { total: complete ? 50 : null, rubricVersion: 'draft-demo-v1',
      dimensions: dimensions.map(d => ({ ...d, points: complete ? 50 : null,
        evidence: complete ? '演示固定等级 2；不是对当前英雄的真实判断。' : '阵容尚未完整，暂不评分。' })) },
    mode: state.mode, dataVersion: data.version, provider: 'browser-demo',
  };
  const area = $('#result'); area.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = complete ? '50 / 100 · 演示评分（非胜率）' : '等待完整阵容 · 演示结果'; area.append(h);
  const texts = [question ? '你的问题：' + question : '未填写问题，展示阵容演示结果。', result.summary,
    ...result.recommendations, ...result.scoring.dimensions.map(d => `${d.label}：${d.points ?? '待评估'} — ${d.evidence}`),
    `数据 ${data.version} · 规则 ${result.scoring.rubricVersion} · 浏览器演示`];
  for (const text of texts) { const p = document.createElement('p'); p.textContent = text; area.append(p); }
  memory.analyses.push({ created: new Date().toISOString(), input: {
    gameId: data.gameId, ally: [...state.ally], enemy: [...state.enemy], question }, result });
  memory.analyses = memory.analyses.slice(-100);
  persist();
}
$('#analyze').onclick = run;
$('#explain').onclick = () => {
  mode('coach');
  if (!$('#question').value.trim()) $('#question').value = '请解释这套阵容的配合与建议。';
  run();
};
const form = $('#profile');
function fill(p) {
  for (const k of ['rank', 'level', 'role', 'preferences']) form.elements[k].value = p[k];
  form.elements.championPool.value = p.championPool.join(',');
}
form.onsubmit = e => {
  e.preventDefault();
  const p = Object.fromEntries(new FormData(form));
  p.championPool = p.championPool.split(',').map(x => x.trim()).filter(Boolean);
  memory.profile = cleanProfile(p); fill(memory.profile);
  if (persist()) $('#profile-status').textContent = '已保存在此浏览器';
};
$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...memory }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'gamecoach-memory.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#delete').onclick = () => {
  if (!confirm('删除此浏览器中的 GameCoach 档案与演示分析记录？此操作无法撤销。')) return;
  try { localStorage.removeItem(storageKey); } catch {
    $('#error').textContent = '浏览器阻止了删除操作。请通过浏览器的网站数据设置清除已保存的数据。'; return;
  }
  memory = { profile: defaults(), analyses: [] }; fill(memory.profile);
  $('#profile-status').textContent = '本地记忆已删除'; $('#result').textContent = '本地记忆已删除。';
};
$('#data-status').textContent = data.version + ' · ' + data.status;
fill(memory.profile); render();
if (!storageAvailable) storageNotice();
