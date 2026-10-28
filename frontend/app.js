'use strict';
const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
const $ = selector => document.querySelector(selector);
const store = window.GCStore;
const games = window.GameCoachGames;
const draftOps = window.GameCoachDraft;
const state = { mode: 'quick', sessionId: null, draft: draftOps.empty(), question: '' };
const profileForm = $('#profile');
const memoryUI = window.GameCoachMemoryUI.create({ store, onChange: () => renderAccount() });
let renderedGameId = null;
let activeRequest = null;
const draftUI = window.GameCoachDraftUI.create({ champions: games.get('lolm').champions, getDraft: () => state.draft,
  onChange(draft) { state.draft = draft; updateDraft(); }, onOpen: () => openDialog('bp-dialog') });
window.addEventListener('gamecoach:ai-changing', () => cancelRequest());
window.addEventListener('gamecoach:language-changing', () => cancelRequest());
window.addEventListener('gamecoach:language-changed', () => {
  draftUI.setChampions(games.get(state.draft.gameId).champions, { preserve: true });
  renderGameMenu(); setMode(state.mode); renderDraft(); renderConversation(); renderAccount(); renderHistory();
  for (const id of ['status', 'account-status', 'profile-status']) $('#' + id).textContent = '';
});
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
  if (activeRequest && state.mode !== mode) cancelRequest();
  state.mode = mode;
  for (const value of ['quick', 'coach']) $('#' + value).setAttribute('aria-pressed', String(value === mode));
  $('#mode-hint').textContent = mode === 'quick' ? tr("自然简短，直接回应") : tr("按问题展开讨论");
}
$('#quick').onclick = () => setMode('quick');
$('#coach').onclick = () => setMode('coach');
function updateDraft() {
  state.draft = store.saveDraft(state.draft); renderDraft();
}
function renderDraft() {
  const game = games.get(state.draft.gameId);
  if (renderedGameId !== game.gameId) { draftUI.setChampions(game.champions); renderedGameId = game.gameId; }
  $('#game-label').textContent = game.name; $('#game-symbol').textContent = game.icon;
  $('#game-selector').style.setProperty('--game-accent', game.accent);
  $('#bp-game-label').textContent = game.name + ' · LINEUP';
  $('#game-open').setAttribute('aria-label', tr("切换游戏，当前：") + game.name);
  for (const option of $('#game-menu').children) option.setAttribute('aria-selected', String(option.dataset.gameId === game.gameId));
  draftUI.render(); resizeInput(); window.dispatchEvent(new CustomEvent('gamecoach:game-changed', { detail: { gameId: game.gameId } }));
}
function closeGameMenu() { $('#game-menu').hidden = true; $('#game-open').setAttribute('aria-expanded', 'false'); }
$('#game-open').onclick = () => { const opening = $('#game-menu').hidden; $('#game-menu').hidden = !opening; $('#game-open').setAttribute('aria-expanded', String(opening)); };
function renderGameMenu() {
$('#game-menu').replaceChildren();
for (const game of [...games.list,
  { gameId: 'hok', name: tr("王者荣耀"), icon: tr("王"), accent: '#b39761', description: tr("峡谷对决 · 敬请期待"), platform: tr("即将开放"), comingSoon: true },
  { gameId: 'dota2', name: 'Dota 2', icon: 'D', accent: '#b66c5b', description: tr("天辉与夜魇 · 敬请期待"), platform: tr("即将开放"), comingSoon: true },
]) {
  const option = button('', 'game-option', () => {
    closeGameMenu(); if (state.draft.gameId === game.gameId) return;
    cancelRequest(); state.draft = store.selectGame(game.gameId); renderDraft(); $('#game-open').focus();
  });
  option.setAttribute('role', 'option'); option.dataset.gameId = game.gameId;
  if (game.comingSoon) { option.disabled = true; option.setAttribute('aria-disabled', 'true'); }
  const icon = element('span', 'game-option-symbol', game.icon); icon.style.setProperty('--option-accent', game.accent);
  const body = element('span', 'game-option-copy'); body.append(element('strong', '', game.name), element('small', '', game.description));
  option.append(icon, body, element('span', 'game-option-platform', game.platform)); $('#game-menu').append(option);
}
}
renderGameMenu();
document.addEventListener('click', event => { if (!$('#game-selector').contains(event.target)) closeGameMenu(); });
$('#game-selector').addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeGameMenu(); $('#game-open').focus(); }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); $('#game-menu').hidden = false; $('#game-open').setAttribute('aria-expanded', 'true');
    const options = [...$('#game-menu').children].filter(option => !option.disabled); const current = options.indexOf(document.activeElement);
    options[(current + (event.key === 'ArrowDown' ? 1 : options.length - 1) + options.length) % options.length]?.focus();
  }
});
function resizeInput() {
  const question = $('#question'); question.style.height = 'auto'; question.style.height = Math.min(question.scrollHeight, 180) + 'px';
  $('#send').disabled = !activeRequest && !question.value.trim() && !draftOps.count(state.draft);
  $('#send').textContent = activeRequest ? '■' : '↑';
  $('#send').setAttribute('aria-label', activeRequest ? tr("停止生成") : tr("发送问题"));
  $('#send').title = activeRequest ? tr("停止生成") : tr("发送（Enter）");
}
$('#question').oninput = () => { state.question = $('#question').value; resizeInput(); };
$('#question').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !activeRequest) { e.preventDefault(); $('#chat-form').requestSubmit(); }
};
for (const prompt of document.querySelectorAll('[data-prompt]')) prompt.onclick = () => {
  if (prompt.dataset.mode) setMode(prompt.dataset.mode);
  $('#question').value = prompt.dataset.prompt; state.question = prompt.dataset.prompt; resizeInput(); $('#question').focus();
};
const currentSession = () => store.current().sessions.find(s => s.id === state.sessionId);
function messageDraftElement(draft) {
  const champions = new Map(games.get(draft?.gameId).champions.map(champion => [champion.id, champion]));
  const names = ids => (ids || []).map(id => champions.get(id)?.name).filter(Boolean).join(window.GameCoachI18n?.locale === 'en' ? ', ' : '、');
  const teams = ['ally', 'enemy'].map(side => ({ side, picks: names(draft?.[side]),
    bans: draft?.bpMode ? names(draft.bans?.[side]?.slice(0, draftOps.banLimit(draft))) : '' }));
  if (!teams.some(team => team.picks || team.bans)) return null;
  const metadata = element('div', 'message-draft'); metadata.setAttribute('role', 'group'); metadata.setAttribute('aria-label', tr("本条消息的阵容"));
  for (const { side, picks, bans } of teams) {
    const row = element('div', 'message-draft-row message-draft-' + side);
    row.setAttribute('role', 'group'); row.setAttribute('aria-label', side === 'ally' ? tr("蓝方阵容") : tr("红方阵容"));
    if (bans) { const banned = element('span', 'message-draft-bans', bans); banned.setAttribute('aria-label', tr("禁用：") + bans); row.append(banned); }
    if (picks) { const selected = element('span', 'message-draft-picks', picks); selected.setAttribute('aria-label', tr("已选：") + picks); row.append(selected); }
    if (!bans && !picks) { const empty = element('span', 'message-draft-empty', '—'); empty.setAttribute('aria-label', tr("未选择")); row.append(empty); }
    metadata.append(row);
  }
  return metadata;
}
function messageElement(message) {
  const wrapper = element('article', 'message message-' + message.role);
  if (message.role === 'user') {
    wrapper.append(element('p', 'user-bubble', message.content));
    const lineup = messageDraftElement(message.draft); if (lineup) wrapper.append(lineup);
    return wrapper;
  }
  wrapper.append(element('span', 'message-logo', '✦'));
  if (message.id) wrapper.id = message.id;
  const body = element('div', 'reply-body');
  const label = message.localOnly ? tr("本地记忆") : message.status === 'pending' ? tr("生成中") : message.status === 'cancelled' ? tr("已停止") : message.status === 'error' ? tr("调用失败") : message.isDemo !== false ? tr("演示回复") : tr("AI 回复");
  const heading = element('div', 'reply-header', 'GameCoach'); heading.append(element('span', 'demo-tag', label)); body.append(heading);
  // 当前加载的前端版本：只显示，不写入 message.content 或历史。
  const buildLabel = window.GameCoachConfig?.testBuildLabel;
  if (buildLabel && !message.localOnly) {
    body.append(element('p', 'message-meta test-build-label',
      '【前端测试 ' + buildLabel + ' · ' + (message.mode === 'coach' ? 'Coach' : 'Quick') + '】'));
  }
  const text = element('div', 'reply-text');
  window.GameCoachMarkdown.renderInto(text, message.content || (message.status === 'pending' ? tr("正在生成…") : message.status === 'cancelled' ? tr("已停止生成。") : tr("没有回复内容。")));
  body.append(text);
  if (message.finishReason === 'length') body.append(element('p', 'message-meta', tr("已达到本次生成上限，可以继续追问。")));
  if (message.sources?.length || message.searchSuggestions) body.append(window.GameCoachMessageSources.render(message));
  if (message.usedMemories?.length) {
    const details = element('details', 'memory-used'), summary = element('summary', '', tr("本次带入 ") + message.usedMemories.length + tr(" 条记忆"));
    const list = element('ul');
    for (const item of message.usedMemories) {
      const seed = window.GAMECOACH_MEMORY_DEFAULTS.find(value => value.id === item.id && value.title === item.title);
      list.append(element('li', '', seed ? window.GameCoachMemory.display({ ...seed, source: 'builtin' }).title : item.title));
    }
    details.append(summary, list, button(tr("管理记忆"), 'text-button', () => memoryUI.open())); body.append(details);
  }
  if (message.status === 'error') {
    body.append(button(tr("重新尝试 ↻"), 'text-button', () => {
      const messages = currentSession()?.messages || []; const at = messages.indexOf(message);
      const question = messages.slice(0, at).reverse().find(item => item.role === 'user');
        if (question) {
          const target = question.inReplyTo && messages.find(item => item.id === question.inReplyTo);
          send(question.content, { draft: question.draft,
            ...(target ? { expansion: window.GameCoachConversation.expansion(messages, target) } : {}) });
        }
    }));
  }
  if (!message.localOnly && message.mode === 'quick' && (!message.status || message.status === 'complete')) {
    const actions = element('div', 'reply-actions');
    actions.append(button(tr("深入解释 ↗"), '', () => {
      try {
        const expansion = window.GameCoachConversation.expansion(currentSession()?.messages || [], message.id || message);
        setMode('coach'); send(tr("展开解释这条回答，继续回答我刚才的问题。"), { expansion });
      } catch (error) { notice(error.message); }
    }));
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
function cancelRequest() {
  const request = activeRequest;
  if (!request) return;
  activeRequest = null;
  cancelAnimationFrame(request.renderFrame);
  request.controller.abort();
  request.reply.status = 'cancelled';
  if (!request.reply.content) request.reply.content = tr("已停止生成。");
  store.persist(); resizeInput(); renderConversation();
}
async function send(override, options = {}) {
  if (activeRequest) return;
  const content = (override || $('#question').value).trim();
  if (!content && !draftOps.count(state.draft)) { $('#question').focus(); return; }
  if (content.length > 4000) { notice(tr("问题请控制在 4000 字以内。")); return; }
  let session = currentSession();
  if (!session) {
    session = { id: store.uuid(), title: (content || tr("阵容分析")).slice(0, 40), created: new Date().toISOString(), messages: [] };
    store.current().sessions.push(session); store.current().sessions = store.current().sessions.slice(-30); state.sessionId = session.id;
  }
  const created = new Date().toISOString();
  const draft = structuredClone(options.expansion?.draft || options.draft || state.draft);
  const mode = state.mode;
  if (!options.expansion && !options.draft) {
    try {
      const command = window.GameCoachMemoryCommands.apply(store.current().memory, content);
      if (command.handled) {
        store.current().memory = command.memory;
        session.messages.push({ role: 'user', content, mode, draft, created, localOnly: true },
          { id: 'reply-' + store.uuid(), role: 'coach', content: command.notice, mode, draft, created, localOnly: true, isDemo: false, status: 'complete' });
        session.messages = session.messages.slice(-100); const saved = store.persist();
        $('#question').value = ''; state.question = ''; resizeInput(); renderConversation(); renderAccount();
        requestAnimationFrame(() => { window.scrollTo({ top: document.body.scrollHeight }); $('#question').focus({ preventScroll: true }); });
        if (!saved) notice(tr("记忆在当前页面生效；请连接文件夹或导出备份以保存。"));
        return;
      }
    } catch (error) { notice(error.message); return; }
  }
  // Skill 用各轮快照区分历史与当前阵容；执行模式仍单独交给 ai-core。
  const input = window.GameCoachConversation.buildHistory(session.messages);
  input.push({ role: 'user', content: content || tr("请分析这套阵容。") });
  const context = { draft: structuredClone(draft), memory: structuredClone(store.current().memory),
    lastCall: window.GameCoachConversation.lastCall(session.messages),
    declarations: window.GameCoachConversation.declarations(session.messages), expansion: options.expansion,
    searchMode: $('#search-mode').value };
  session.messages.push({ role: 'user', content: input.at(-1).content, mode, draft, created, inReplyTo: options.expansion?.replyId });
  const reply = { id: 'reply-' + store.uuid(), role: 'coach', content: '', mode, draft: structuredClone(draft), created, status: 'pending' };
  session.messages.push(reply);
  const request = { controller: new AbortController(), renderFrame: 0, reply, userId: store.current().id, sessionId: session.id };
  activeRequest = request;
  store.persist(); $('#question').value = ''; state.question = ''; resizeInput(); renderConversation();
  requestAnimationFrame(() => { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); $('#question').focus({ preventScroll: true }); });
  const isCurrent = () => activeRequest === request && store.current().id === request.userId && state.sessionId === request.sessionId;
  try {
    const response = await window.GameCoachSkill.run(input, {
      context, mode, signal: request.controller.signal,
      ...(window.GameCoachBackend?.isActive() ? { conversation: {
        id: session.id, userId: request.userId, replyId: reply.id,
        user: { name: store.current().name, profile: structuredClone(store.current().profile) },
      } } : {}),
      onRetry({ attempt, maxAttempts }) {
        if (isCurrent()) {
          const tag = document.getElementById(reply.id)?.querySelector('.demo-tag');
          if (tag) tag.textContent = tr("正在重试 ") + attempt + '/' + maxAttempts;
        }
      },
      onDelta(delta) {
        if (!isCurrent()) return;
        reply.content += delta;
        if (request.renderFrame) return;
        request.renderFrame = requestAnimationFrame(() => {
          request.renderFrame = 0;
          if (!isCurrent()) return;
          const follow = window.scrollY + window.innerHeight >= document.body.scrollHeight - 140;
          const text = document.getElementById(reply.id)?.querySelector('.reply-text');
          if (text) window.GameCoachMarkdown.renderInto(text, reply.content);
          if (follow) window.scrollTo({ top: document.body.scrollHeight });
        });
      },
    });
    if (!isCurrent()) return;
    reply.content = response.content;
    reply.provider = response.provider; reply.model = response.model; reply.isDemo = response.isDemo;
    reply.upstreamProvider = response.upstreamProvider;
    reply.reasoningEffort = response.reasoningEffort; reply.status = 'complete'; reply.timings = response.timings; reply.finishReason = response.finishReason;
    reply.sources = response.sources; reply.searchSuggestions = response.searchSuggestions; reply.searched = response.searched;
    reply.attempts = response.attempts; reply.usage = response.usage;
    reply.usedMemories = response.usedMemories;
  } catch (error) {
    if (!isCurrent()) return;
    reply.status = error.name === 'AbortError' ? 'cancelled' : 'error';
    reply.attempts = error.attempts || 1;
    reply.content = (reply.content ? reply.content + '\n\n' : '') + (error.name === 'AbortError' ? tr("已停止生成。")
      : tr("生成失败：") + error.message + (error.attempts > 1 ? tr("（已尝试 ") + error.attempts + tr(" 次）") : ''));
  } finally {
    cancelAnimationFrame(request.renderFrame);
    if (isCurrent()) {
      activeRequest = null; session.messages = session.messages.slice(-100);
      store.persist(); resizeInput(); renderConversation();
    }
  }
}
$('#chat-form').onsubmit = e => { e.preventDefault(); if (activeRequest) cancelRequest(); else send(); };
function newChat() { cancelRequest(); state.sessionId = null; $('#question').value = ''; state.question = ''; resizeInput(); renderConversation(); $('#question').focus(); window.scrollTo({ top: 0 }); }
$('#new-chat').onclick = newChat;
$('#history-new').onclick = () => { $('#history-dialog').close(); newChat(); };
function renderHistory() {
  const list = $('#history-list'); list.replaceChildren();
  for (const session of [...store.current().sessions].reverse()) {
    const control = button(session.title, 'history-item', () => {
      cancelRequest();
      state.sessionId = session.id;
      const last = session.messages.at(-1);
      if (last) { state.draft = structuredClone(last.draft); setMode(last.mode); updateDraft(); }
      $('#question').value = ''; state.question = ''; resizeInput(); renderConversation(); $('#history-dialog').close(); window.scrollTo({ top: 0 });
    });
    control.setAttribute('aria-pressed', String(session.id === state.sessionId));
    const date = new Date(session.created);
    control.append(element('span', '', (Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(window.GameCoachI18n?.locale)) + tr(" · {0} 轮对话", Math.floor(session.messages.length / 2)))); list.append(control);
  }
  if (!list.childElementCount) list.append(element('p', 'empty-history', tr("还没有对话。聊聊你的第一场对局吧。")));
}
function loadCurrentUser() {
  state.draft = structuredClone(store.current().draft);
  state.sessionId = store.current().sessions.at(-1)?.id || null;
  $('#question').value = ''; state.question = ''; $('#search').value = '';
  setMode(currentSession()?.messages.at(-1)?.mode || 'quick'); renderDraft(); resizeInput(); renderConversation(); renderAccount();
}
window.addEventListener('gamecoach:user-restored', () => {
  const selected = state.sessionId, mode = state.mode;
  cancelRequest(); loadCurrentUser();
  if (store.current().sessions.some(item => item.id === selected)) {
    state.sessionId = selected; setMode(mode); renderConversation();
  }
});
$('#database-source').onchange = event => {
  if (event.target.value === 'import') $('#import-user').click();
  else { cancelRequest(); store.select(store.users()[0].id); loadCurrentUser(); }
};
function renderAccount() {
  const user = store.current();
  $('#account-open').textContent = $('#account-avatar').textContent = Array.from(user.name)[0];
  $('#account-open').title = user.name + tr(" · 本地用户");
  $('#account-name').textContent = user.name;
  for (const field of ['rank', 'level', 'role', 'preferences']) profileForm.elements[field].value = user.profile[field];
  profileForm.elements.championPool.value = user.profile.championPool.join(', ');
  $('#memory-summary').textContent = (user.memory.enabled ? tr("已启用") : tr("已暂停")) + ' · ' + user.memory.entries.length + tr(" 条本地记忆");
  const list = $('#user-list'); list.replaceChildren();
  for (const entry of store.users()) {
    const control = button(entry.name, 'user-choice', () => {
      cancelRequest();
      store.select(entry.id); loadCurrentUser(); $('#profile-status').textContent = ''; $('#account-status').textContent = tr("已切换到 ") + entry.name;
    });
    control.setAttribute('aria-pressed', String(entry.id === user.id));
    control.setAttribute('aria-label', tr("切换到") + entry.name); list.append(control);
  }
}
$('#create-user').onsubmit = e => {
  e.preventDefault();
  cancelRequest();
  try { store.create($('#new-username').value); $('#new-username').value = ''; loadCurrentUser(); $('#account-status').textContent = tr("新用户已创建，资料和对话独立保存。"); }
  catch (error) { $('#account-status').textContent = error.message; }
};
profileForm.onsubmit = e => {
  e.preventDefault();
  const profile = Object.fromEntries(new FormData(profileForm));
  profile.championPool = profile.championPool.split(/[,，]/).map(x => x.trim()).filter(Boolean);
  const previousProfile = store.current().profile;
  store.current().profile = store.cleanProfile(profile);
  store.current().memory = window.GameCoachMemory.withProfile(store.current().memory, store.current().profile, previousProfile);
  const saved = store.persist();
  renderAccount();
  $('#profile-status').textContent = saved ? tr("已保存为个人记忆，按问题相关性参考。") : tr("当前页面已更新，请连接文件夹或导出以保存。");
};
$('#memory-open').onclick = () => memoryUI.open();
$('#connect-folder').onclick = async () => {
  cancelRequest();
  $('#connect-folder').disabled = true;
  try {
    const name = await store.connectFolder(); loadCurrentUser();
    $('#folder-status').textContent = tr("已连接：") + name + tr(" · 用户文件自动同步");
    $('#account-status').textContent = tr("用户已合并并保存到电脑，本地文件不会上传。");
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
    if (file.size > 10_000_000) throw new Error(tr("备份文件请控制在 10 MB 以内。"));
    const backup = JSON.parse(await file.text()); cancelRequest();
    store.importBackup(backup); loadCurrentUser(); $('#account-status').textContent = tr("已导入为独立用户，原有用户未被覆盖。");
  } catch (error) { $('#account-status').textContent = error instanceof SyntaxError ? tr("无法解析 JSON，请选择有效的用户备份。") : error.message; }
  e.target.value = '';
};
$('#export-private-access').onclick = () => {
  try {
    const blob = new Blob([JSON.stringify(window.GameCoachBackend.recoveryFile(), null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), link = element('a');
    link.href = url; link.download = 'gamecoach-private-access.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { $('#account-status').textContent = error.message; }
};
$('#import-private-access').onchange = async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 10000) throw new Error(tr('私有恢复文件无效，请检查文件和服务器地址。'));
    cancelRequest();
    await window.GameCoachBackend.restoreAccess(JSON.parse(await file.text()), $('#team-access-code').value);
    $('#team-access-code').value = ''; loadCurrentUser();
  } catch (error) { $('#account-status').textContent = error instanceof SyntaxError ? tr('私有恢复文件无效，请检查文件和服务器地址。') : error.message; }
  finally { event.target.value = ''; $('#team-access-code').value = ''; }
};
store.setReporter(notice);
loadCurrentUser();
resizeInput();
