"use strict";
// 面板负责手动保存和自动恢复；连接仍使用原有 backend 接口。
(() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0];
  const $ = selector => document.querySelector(selector);
  const api = window.GameCoachBackend, preferences = window.GameCoachApiPreferences;
  let revision = 0, currentGameId = 'lolm', activeScope = preferences.scope();
  function changing() { revision++; window.dispatchEvent(new Event('gamecoach:ai-changing')); }
  function refresh() {
    const live = api.isActive();
    const provider = {gemini: 'Google Gemini', deepseek: 'DeepSeek', openai: 'OpenAI', grok: 'xAI Grok', claude: 'Anthropic Claude'}[api.getProviderName()] || tr('服务器默认');
    $('#ai-state').textContent = live ? tr('API 已连接') : tr('演示模式');
    $('#provider-label').textContent = (window.GameCoachGames?.get(currentGameId)?.name || tr('英雄联盟手游'))
      + (live ? ' · ' + provider + tr(' · 服务器处理') : tr(' · 本地演示'));
    $('#ai-settings-shortcut').textContent = live ? tr('API 设置') : tr('连接 API');
    $('#test-ai').disabled = !live; $('#disconnect-ai').disabled = !live;
    $('#ai-connection-status').textContent = live ? tr('历史和 training memory 按用户保存，切换 API 继续共用。') : tr('连接后由服务器处理模型请求。');
  }
  function fill(saved) {
    $('#api-provider').value = saved?.provider || '';
    $('#api-key').value = saved?.apiKeys[saved.provider] || '';
    $('#team-access-code').value = saved?.accessCode || '';
    $('#search-mode').value = saved?.searchMode || 'off';
  }
  function formSettings() {
    const provider = $('#api-provider').value;
    return {version: 1, provider, enabled: true,
      apiKeys: {...preferences.load()?.apiKeys, [provider]: $('#api-key').value.trim()},
      accessCode: $('#team-access-code').value, searchMode: $('#search-mode').value || 'off'};
  }
  async function connect(saved, automatic = false, persisted = true) {
    changing(); api.disconnect(); refresh(); const current = revision, scope = preferences.scope();
    $('#connect-api').disabled = true;
    $('#ai-feedback').textContent = automatic ? tr('正在恢复 API 连接…') : tr('正在连接…');
    try {
      const result = await api.connect({provider: saved.provider,
        apiKey: saved.apiKeys[saved.provider] || '', accessCode: saved.accessCode});
      if (current !== revision || scope !== preferences.scope()) return;
      api.activate(result.provider);
      $('#ai-feedback').textContent = persisted ? tr('API 已连接') : tr('API 已连接，但浏览器无法保存配置。');
      refresh();
    } catch (error) {
      if (current === revision && scope === preferences.scope()) $('#ai-feedback').textContent = error.message;
    } finally { if (current === revision) $('#connect-api').disabled = false; }
  }
  function restore() {
    changing(); api.disconnect(); $('#connect-api').disabled = false;
    const saved = preferences.load(); fill(saved); refresh(); $('#ai-feedback').textContent = '';
    return saved?.enabled ? connect(saved, true) : Promise.resolve();
  }
  $('#ai-settings-shortcut').onclick = () => { $('#account-open').click(); $('#ai-connection-section').scrollIntoView({block: 'start'}); $('#api-key').focus(); };
  $('#api-provider').onchange = () => {
    changing(); api.disconnect(); $('#connect-api').disabled = false;
    const saved = preferences.load();
    $('#api-key').value = saved?.apiKeys[$('#api-provider').value] || '';
    refresh(); $('#ai-feedback').textContent = '';
  };
  for (const selector of ['#api-key', '#team-access-code']) $(selector).oninput = () => {
    changing(); api.disconnect(); $('#connect-api').disabled = false; refresh();
  };
  $('#ai-connection-form').onsubmit = async event => {
    event.preventDefault();
    const saved = formSettings();
    const persisted = preferences.save(saved); // 仅手动提交覆盖本地配置；自动恢复不写配置。
    await connect(saved, false, persisted);
  };
  $('#disconnect-ai').onclick = () => {
    changing(); api.disconnect(); $('#connect-api').disabled = false;
    const saved = preferences.load(); if (saved) preferences.save({...saved, enabled: false});
    refresh(); $('#ai-feedback').textContent = tr('API 已断开，用户数据和记忆保留。');
  };
  $('#forget-api-key').onclick = async () => {
    changing(); const current = revision, scope = preferences.scope();
    const provider = $('#api-provider').value || api.getProviderName();
    const saved = preferences.load();
    if (saved) {
      const keys = {...saved.apiKeys}; delete keys[provider];
      if (!$('#api-provider').value) delete keys[''];
      preferences.save({...saved, apiKeys: keys, enabled: false});
    }
    $('#api-key').value = ''; api.disconnect(); $('#connect-api').disabled = false; refresh();
    try {
      await api.forgetKey(provider);
      if (current === revision && scope === preferences.scope()) $('#ai-feedback').textContent = tr('已删除此用户保存的 Key；服务器默认 Key 由管理员管理。');
    } catch (error) { if (current === revision) $('#ai-feedback').textContent = error.message; }
  };
  $('#test-ai').onclick = async () => {
    const current = revision; $('#test-ai').disabled = true;
    try { await api.testConnection(); if (current === revision) $('#ai-feedback').textContent = tr('厂商接口和模型信息可访问；请发送消息验证实际生成和额度。'); }
    catch (error) { if (current === revision) $('#ai-feedback').textContent = error.message; }
    finally { if (current === revision) refresh(); }
  };
  window.addEventListener('gamecoach:game-changed', event => {currentGameId = event.detail.gameId; refresh();});
  window.addEventListener('gamecoach:language-changed', refresh);
  window.addEventListener('gamecoach:user-updated', () => {
    const scope = preferences.scope();
    if (scope !== activeScope) { activeScope = scope; restore(); }
  });
  window.addEventListener('gamecoach:sync-failed', () => { $('#ai-feedback').textContent = tr('服务器同步失败，本机修改仍保留；网络恢复后可重新连接。'); });
  window.GameCoachApiSettings = {ready: restore()};
})();
