"use strict";

// API 面板专用本地配置。不进入用户备份或服务器 user-state。
window.GameCoachApiPreferences = (() => {
  const providers = new Set(['', 'gemini', 'deepseek', 'openai', 'grok', 'claude']);
  const volatile = new Map();
  function scope() {
    const origin = window.GameCoachBackend.getApiOrigin();
    const userId = window.GCStore.current().id;
    return origin ? 'gamecoach-api-options:v1:' + encodeURIComponent(origin) + ':' + userId : null;
  }
  function clean(value) {
    if (!value || value.version !== 1 || !providers.has(value.provider)) return null;
    const keys = Object.fromEntries(Object.entries(value.apiKeys || {}).filter(([provider, key]) =>
      providers.has(provider) && typeof key === 'string'));
    return {version: 1, provider: value.provider, apiKeys: keys,
      accessCode: typeof value.accessCode === 'string' ? value.accessCode : '',
      searchMode: ['off', 'on', 'auto'].includes(value.searchMode) ? value.searchMode : 'off',
      enabled: value.enabled === true};
  }
  function load() {
    const key = scope();
    if (!key) return null;
    try { const value = clean(JSON.parse(localStorage.getItem(key) || 'null')); if (value) return value; } catch {}
    return clean(volatile.get(key));
  }
  function save(value) {
    const key = scope(), data = clean(value);
    if (!key || !data) return false;
    volatile.set(key, data);
    try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
  }
  return Object.freeze({load, save, scope});
})();
