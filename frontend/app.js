'use strict';
const $ = selector => document.querySelector(selector);
const store = window.GCStore;
const data = window.GAMECOACH_DATA;
const state = { mode: 'quick', target: 'ally', sessionId: null, draft: { ally: [], enemy: [] }, question: '' };
const profileForm = $('#profile');
const champions = new Map(data.champions.map(c => [c.id, c]));
const dimensions = ['开团能力', '保护能力', '伤害覆盖', '前排能力', '节奏配合'];
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function button(text, className, action) {
  const el = element('button', className, text); el.type = 'button'; el.onclick = action; return el;
}
function notice(text) { $('#status').textContent = text; }
function openDialog(id) {
  if (id === 'bp-dialog') renderDraft();
  if (id === 'account-dialog') renderAccount();
  if (id === 'history-dialog') renderHistory();
  $('#' + id).showModal();
}
for (const control of document.querySelectorAll('[data-close]')) control.onclick = () => $('#' + control.dataset.close).close();
for (const dialog of document.querySelectorAll('dialog')) dialog.onclick = e => {
  if (e.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) dialog.close();
};
$('#bp-open').onclick = $('#composer-bp').onclick = () => openDialog('bp-dialog');
$('#account-open').onclick = () => openDialog('account-dialog');
$('#history-open').onclick = () => openDialog('history-dialog');
function setMode(mode) {
  state.mode = mode;
  for (const value of ['quick', 'coach']) $('#' + value).setAttribute('aria-pressed', String(value === mode));
  $('#mode-hint').textContent = mode === 'quick' ? '简短建议，先给结论' : '展开思路，一起复盘';
}
$('#quick').onclick = () => setMode('quick');
$('#coach').onclick = () => setMode('coach');
function updateDraft() {
  store.current().draft = structuredClone(state.draft); store.persist(); renderDraft();
}
function renderDraft() {
  const count = state.draft.ally.length + state.draft.enemy.length;
  $('#bp-count').textContent = count + '/10';
  $('#draft-label').textContent = count ? `我方 ${state.draft.ally.length} · 敌方 ${state.draft.enemy.length}` : '添加阵容';
  $('#composer-bp').classList.toggle('active', count > 0);
  for (const side of ['ally', 'enemy']) {
    $('#' + side + '-target').setAttribute('aria-pressed', String(state.target === side));
    $('#' + side + '-count').textContent = state.draft[side].length + ' / 5';
    const slots = $('#' + side); slots.replaceChildren();
    for (const id of state.draft[side]) {
      const champion = champions.get(id);
      const remove = button('', '', () => { state.draft[side] = state.draft[side].filter(x => x !== id); updateDraft(); });
      remove.setAttribute('aria-label', '移除' + (side === 'ally' ? '我方' : '敌方') + champion.name);
      const img = element('img'); img.src = champion.portrait; img.alt = '';
      remove.append(img, element('span', '', champion.name)); slots.append(remove);
    }
    for (let i = state.draft[side].length; i < 5; i++) slots.append(element('span', 'slot', '＋'));
  }
  const query = $('#search').value.trim().toLowerCase();
  const pool = $('#champions'); pool.replaceChildren();
  for (const champion of data.champions.filter(c => (c.id + c.name).toLowerCase().includes(query))) {
    const pick = button('', 'champion', () => {
      if (state.draft[state.target].length >= 5 || state.draft.ally.includes(champion.id) || state.draft.enemy.includes(champion.id)) return;
      state.draft[state.target].push(champion.id); updateDraft();
    });
    pick.setAttribute('aria-label', '选择' + champion.name);
    pick.disabled = state.draft[state.target].length >= 5 || state.draft.ally.includes(champion.id) || state.draft.enemy.includes(champion.id);
    const img = element('img'); img.src = champion.portrait; img.alt = '';
    pick.append(img, element('span', '', champion.name)); pool.append(pick);
  }
  if (!pool.childElementCount) pool.append(element('p', 'subtle', '没有找到匹配的演示英雄。'));
  resizeInput();
}
$('#ally-target').onclick = () => { state.target = 'ally'; renderDraft(); };
$('#enemy-target').onclick = () => { state.target = 'enemy'; renderDraft(); };
$('#search').oninput = renderDraft;
$('#reset').onclick = () => { state.draft = { ally: [], enemy: [] }; updateDraft(); };
function resizeInput() {
  const question = $('#question'); question.style.height = 'auto'; question.style.height = Math.min(question.scrollHeight, 180) + 'px';
  $('#send').disabled = !question.value.trim() && !state.draft.ally.length && !state.draft.enemy.length;
}
$('#question').oninput = () => { state.question = $('#question').value; resizeInput(); };
$('#question').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); }
};
for (const prompt of document.querySelectorAll('[data-prompt]')) prompt.onclick = () => {
  if (prompt.dataset.mode) setMode(prompt.dataset.mode);
  $('#question').value = prompt.dataset.prompt; state.question = prompt.dataset.prompt; resizeInput(); $('#question').focus();
};
const currentSession = () => store.current().sessions.find(s => s.id === state.sessionId);
function draftDescription(draft) {
  const names = side => draft[side].map(id => champions.get(id)?.name).filter(Boolean).join('、') || '未选择';
  return `我方：${names('ally')} · 敌方：${names('enemy')}`;
}
function messageElement(message) {
  const wrapper = element('article', 'message message-' + message.role);
  if (message.role === 'user') {
    wrapper.append(element('p', 'user-bubble', message.content));
    if (message.draft.ally.length || message.draft.enemy.length) wrapper.append(element('p', 'message-meta', draftDescription(message.draft)));
    return wrapper;
  }
  wrapper.append(element('span', 'message-logo', '✦'));
  const body = element('div', 'reply-body');
  const heading = element('div', 'reply-header', 'GameCoach'); heading.append(element('span', 'demo-tag', '演示回复')); body.append(heading);
  body.append(element('p', 'reply-text', message.content));
  const suggestions = element('ul', 'reply-list');
  for (const text of ['根据英雄池选择熟悉的英雄。', '选齐双方阵容，再讨论团队配合。']) suggestions.append(element('li', '', '演示：' + text));
  body.append(suggestions);
  const complete = message.draft.ally.length === 5 && message.draft.enemy.length === 5;
  const details = element('details', 'score-details');
  details.append(element('summary', '', complete ? '阵容评分 · 50 / 100（演示）' : '阵容评分 · 等待完整阵容'));
  const grid = element('div', 'score-grid');
  for (const dimension of dimensions) {
    const row = element('span', '', dimension); row.append(element('strong', '', complete ? '50' : '待评估')); grid.append(row);
  }
  details.append(grid, element('p', '', '固定规则 draft-demo-v1 · 完整阵容固定为 50 分，不代表真实实力或胜率。'));
  body.append(details);
  if (message.mode === 'quick') {
    const actions = element('div', 'reply-actions');
    actions.append(button('深入解释 ↗', '', () => { state.draft = structuredClone(message.draft); updateDraft(); setMode('coach'); send('请进一步解释这套阵容的配合与复盘思路。'); }));
    body.append(actions);
  }
  wrapper.append(body); return wrapper;
}
function renderConversation() {
  const session = currentSession();
  $('#messages').replaceChildren();
  const hasChat = !!session?.messages.length;
  $('#workspace').classList.toggle('has-chat', hasChat);
  if (hasChat) for (const message of session.messages) $('#messages').append(messageElement(message));
}
function send(override) {
  const content = (override || $('#question').value).trim();
  if (!content && !state.draft.ally.length && !state.draft.enemy.length) { $('#question').focus(); return; }
  if (content.length > 4000) { notice('问题请控制在 4000 字以内。'); return; }
  let session = currentSession();
  if (!session) {
    session = { id: store.uuid(), title: (content || '阵容分析').slice(0, 40), created: new Date().toISOString(), messages: [] };
    store.current().sessions.push(session); store.current().sessions = store.current().sessions.slice(-30); state.sessionId = session.id;
  }
  const created = new Date().toISOString();
  const draft = structuredClone(state.draft);
  session.messages.push({ role: 'user', content: content || '请分析这套阵容。', mode: state.mode, draft, created });
  const reply = state.mode === 'quick'
    ? '优先检查前排、控制和保护是否完整。\n\n当前是界面演示，尚未接入真实 AI，不会根据你的问题或英雄做实际推理。'
    : '可以从开团、保护、伤害覆盖、前排和节奏这五个角度梳理思路，再结合你的英雄池与打法偏好讨论。\n\n当前是界面演示，尚未接入真实 AI；这里展示的是示例回复。';
  session.messages.push({ role: 'coach', content: reply, mode: state.mode, draft: structuredClone(draft), created });
  session.messages = session.messages.slice(-100);
  store.persist(); $('#question').value = ''; state.question = ''; resizeInput(); renderConversation();
  requestAnimationFrame(() => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); $('#question').focus({ preventScroll: true }); });
}
$('#chat-form').onsubmit = e => { e.preventDefault(); send(); };
function newChat() { state.sessionId = null; $('#question').value = ''; state.question = ''; resizeInput(); renderConversation(); $('#question').focus(); window.scrollTo({ top: 0 }); }
$('#new-chat').onclick = newChat;
$('#history-new').onclick = () => { $('#history-dialog').close(); newChat(); };
function renderHistory() {
  const list = $('#history-list'); list.replaceChildren();
  for (const session of [...store.current().sessions].reverse()) {
    const control = button(session.title, 'history-item', () => {
      state.sessionId = session.id;
      const last = session.messages.at(-1);
      if (last) { state.draft = structuredClone(last.draft); setMode(last.mode); updateDraft(); }
      $('#question').value = ''; state.question = ''; resizeInput(); renderConversation(); $('#history-dialog').close(); window.scrollTo({ top: 0 });
    });
    control.setAttribute('aria-pressed', String(session.id === state.sessionId));
    const date = new Date(session.created);
    control.append(element('span', '', (Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()) + ` · ${Math.floor(session.messages.length / 2)} 轮对话`)); list.append(control);
  }
  if (!list.childElementCount) list.append(element('p', 'empty-history', '还没有对话。聊聊你的第一场对局吧。'));
}
function loadCurrentUser() {
  state.draft = structuredClone(store.current().draft); state.target = 'ally';
  state.sessionId = store.current().sessions.at(-1)?.id || null;
  $('#question').value = ''; state.question = ''; $('#search').value = '';
  setMode('quick'); renderDraft(); resizeInput(); renderConversation(); renderAccount();
}
function renderAccount() {
  const user = store.current();
  $('#account-open').textContent = $('#account-avatar').textContent = Array.from(user.name)[0];
  $('#account-open').title = user.name + ' · 本地用户';
  $('#account-name').textContent = user.name;
  for (const field of ['rank', 'level', 'role', 'preferences']) profileForm.elements[field].value = user.profile[field];
  profileForm.elements.championPool.value = user.profile.championPool.join(', ');
  const list = $('#user-list'); list.replaceChildren();
  for (const entry of store.users()) {
    const control = button(entry.name, 'user-choice', () => {
      store.select(entry.id); loadCurrentUser(); $('#profile-status').textContent = ''; $('#account-status').textContent = '已切换到 ' + entry.name;
    });
    control.setAttribute('aria-pressed', String(entry.id === user.id));
    control.setAttribute('aria-label', '切换到' + entry.name); list.append(control);
  }
}
$('#create-user').onsubmit = e => {
  e.preventDefault();
  try { store.create($('#new-username').value); $('#new-username').value = ''; loadCurrentUser(); $('#account-status').textContent = '新用户已创建，资料和对话独立保存。'; }
  catch (error) { $('#account-status').textContent = error.message; }
};
profileForm.onsubmit = e => {
  e.preventDefault();
  const profile = Object.fromEntries(new FormData(profileForm));
  profile.championPool = profile.championPool.split(/[,，]/).map(x => x.trim()).filter(Boolean);
  store.current().profile = store.cleanProfile(profile);
  const saved = store.persist();
  $('#profile-status').textContent = saved ? '已保存当前用户资料。' : '当前页面已更新，请连接文件夹或导出以保存。';
};
$('#connect-folder').onclick = async () => {
  $('#connect-folder').disabled = true;
  try {
    const name = await store.connectFolder(); loadCurrentUser();
    $('#folder-status').textContent = '已连接：' + name + ' · 用户文件自动同步';
    $('#account-status').textContent = '用户已合并并保存到电脑，本地文件不会上传。';
  } catch (error) { if (error.name !== 'AbortError') $('#account-status').textContent = error.message; }
  finally { $('#connect-folder').disabled = false; }
};
$('#export-user').onclick = () => {
  const blob = new Blob([JSON.stringify(store.exportUser(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = element('a');
  link.href = url; link.download = 'gamecoach-user-' + store.current().id + '.json';
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#import-user').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 10_000_000) throw new Error('备份文件请控制在 10 MB 以内。');
    store.importBackup(JSON.parse(await file.text())); loadCurrentUser(); $('#account-status').textContent = '已导入为独立用户，原有用户未被覆盖。';
  } catch (error) { $('#account-status').textContent = error instanceof SyntaxError ? '无法解析 JSON，请选择有效的用户备份。' : error.message; }
  e.target.value = '';
};
store.setReporter(notice);
loadCurrentUser();
resizeInput();
