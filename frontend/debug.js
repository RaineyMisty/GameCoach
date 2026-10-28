"use strict";

// 页面版本和独立 Skill 快照。快照不写入聊天正文或普通用户备份。
window.GameCoachDebug = (() => {
  const version = window.GameCoachConfig?.testBuildLabel;
  const panel = document.getElementById('debug-panel');
  const build = document.getElementById('debug-build');
  const request = document.getElementById('debug-request');
  const enabled = !!(version && panel && build && request);
  if (enabled) { panel.hidden = false; build.textContent = 'Build ' + version; }
  function start(mode) {
    if (enabled) request.textContent = (mode === 'coach' ? 'Coach' : 'Quick') + ' · pending';
  }
  function finish(response) {
    if (!enabled) return;
    request.textContent = [response.mode === 'coach' ? 'Coach' : 'Quick',
      response.upstreamProvider || response.provider, response.model,
      Number.isFinite(response.timings?.totalMs) ? Math.round(response.timings.totalMs) + ' ms' : '']
      .filter(Boolean).join(' · ');
  }
  function fail(error) {
    if (enabled) request.textContent = error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
  const inspector = document.getElementById('skill-debug-dialog');
  const meta = document.getElementById('skill-debug-meta');
  const received = document.getElementById('skill-debug-input');
  const prepared = document.getElementById('skill-debug-prepared');
  const skillEnabled = window.GameCoachConfig?.skillDebugEnabled === true && !!(inspector && meta && received && prepared);
  const traces = new Map(), loadedUsers = new Set();
  let selected = null;
  const currentUser = () => window.GCStore?.current()?.id || 'local';
  const storageKey = userId => 'gamecoach-skill-debug:v1:'
    + encodeURIComponent(window.GameCoachConfig?.apiBaseUrl || window.location?.origin || 'local') + ':' + userId;
  const traceKey = (userId, replyId) => userId + ':' + replyId;
  function load(userId) {
    if (loadedUsers.has(userId)) return;
    loadedUsers.add(userId);
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey(userId)) || '[]');
      if (Array.isArray(saved)) for (const trace of saved.slice(-20)) {
        if (trace.userId === userId && typeof trace.replyId === 'string') traces.set(traceKey(userId, trace.replyId), trace);
      }
    } catch {}
  }
  function capture(replyId, userId, value) {
    if (!skillEnabled) return;
    load(userId);
    const key = traceKey(userId, replyId);
    const trace = traces.get(key) || {replyId, userId, build: version, capturedAt: new Date().toISOString()};
    if (value.stage === 'received') trace.received = structuredClone(value);
    else trace.prepared = structuredClone(value);
    traces.set(key, trace);
    const recent = [...traces.values()].filter(item => item.userId === userId);
    for (const old of recent.slice(0, -20)) traces.delete(traceKey(userId, old.replyId));
    try { sessionStorage.setItem(storageKey(userId), JSON.stringify(recent.slice(-20))); } catch {}
  }
  function open(replyId) {
    if (!skillEnabled) return;
    const userId = currentUser(); load(userId);
    selected = traces.get(traceKey(userId, replyId)) || null;
    meta.textContent = selected ? [selected.received?.mode, selected.build, selected.capturedAt].filter(Boolean).join(' · ')
      : '这条回答没有 Skill 快照。请开启调试后发送一条新消息。';
    received.textContent = selected ? JSON.stringify(selected.received || {}, null, 2) : '';
    prepared.textContent = selected?.prepared?.stage === 'demo' ? '演示模式：未执行真实 Skill。'
      : selected?.prepared ? JSON.stringify(selected.prepared, null, 2) : selected ? 'Skill 尚未完成输入整理。' : '';
    inspector.showModal();
  }
  const close = document.getElementById('skill-debug-close');
  if (close) close.onclick = () => inspector.close();
  const copy = document.getElementById('skill-debug-copy');
  if (copy) copy.onclick = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(JSON.stringify(selected, null, 2)); }
    catch { meta.textContent = '复制未成功，可以直接选择下方文字复制。'; }
  };
  return Object.freeze({start, finish, fail, enabled: skillEnabled, capture, open});
})();
