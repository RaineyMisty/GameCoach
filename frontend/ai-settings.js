"use strict";
// The form sends credentials only to the authenticated same-origin backend.
(() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0];
  const $ = selector => document.querySelector(selector);
  const api = window.GameCoachBackend;
  let revision = 0, currentGameId = 'lolm';
  function changing() { revision++; window.dispatchEvent(new Event('gamecoach:ai-changing')); }
  function refresh() {
    const live = api.isActive();
    const provider = { gemini: 'Google Gemini', deepseek: 'DeepSeek', openai: 'OpenAI', grok: 'xAI Grok', claude: 'Anthropic Claude' }[api.getProviderName()] || tr('服务器默认');
    $('#ai-state').textContent = live ? tr('API 已连接') : tr('演示模式');
    $('#provider-label').textContent = (window.GameCoachGames?.get(currentGameId)?.name || tr('英雄联盟手游'))
      + (live ? ' · ' + provider + tr(' · 服务器处理') : tr(' · 本地演示'));
    $('#ai-settings-shortcut').textContent = live ? tr('API 设置') : tr('连接 API');
    $('#test-ai').disabled = !live; $('#disconnect-ai').disabled = !live;
    $('#ai-connection-status').textContent = live ? tr('历史和 training memory 按用户保存，切换 API 继续共用。') : tr('连接后由服务器处理模型请求。');
  }
  $('#ai-settings-shortcut').onclick = () => { $('#account-open').click(); $('#ai-connection-section').scrollIntoView({block:'start'}); $('#api-key').focus(); };
  $('#api-provider').onchange = () => { changing(); api.disconnect(); refresh(); $('#ai-feedback').textContent = ''; };
  $('#ai-connection-form').onsubmit = async event => {
    event.preventDefault(); changing(); const current = revision;
    let apiKey = $('#api-key').value, accessCode = $('#team-access-code').value;
    $('#api-key').value = ''; $('#team-access-code').value = ''; $('#connect-api').disabled = true;
    $('#ai-feedback').textContent = tr('正在连接…');
    try {
      const result = await api.connect({provider: $('#api-provider').value, apiKey, accessCode});
      if (current === revision) { api.activate(result.provider); $('#ai-feedback').textContent = tr('API 已连接'); refresh(); }
    } catch (error) { if (current === revision) $('#ai-feedback').textContent = error.message; }
    finally { apiKey = ''; accessCode = ''; $('#connect-api').disabled = false; }
  };
  $('#disconnect-ai').onclick = () => { changing(); api.disconnect(); refresh(); $('#ai-feedback').textContent = tr('API 已断开，用户数据和记忆保留。'); };
  $('#forget-api-key').onclick = async () => {
    try { await api.forgetKey($('#api-provider').value || api.getProviderName()); changing(); api.disconnect(); refresh(); $('#ai-feedback').textContent = tr('已删除此用户保存的 Key；服务器默认 Key 由管理员管理。'); }
    catch (error) { $('#ai-feedback').textContent = error.message; }
  };
  $('#test-ai').onclick = async () => {
    const current = revision; $('#test-ai').disabled = true;
    try { await api.testConnection(); if (current === revision) $('#ai-feedback').textContent = tr('厂商接口和模型信息可访问；请发送消息验证实际生成和额度。'); }
    catch (error) { if (current === revision) $('#ai-feedback').textContent = error.message; }
    finally { if (current === revision) refresh(); }
  };
  window.addEventListener('gamecoach:game-changed', event => { currentGameId = event.detail.gameId; refresh(); });
  window.addEventListener('gamecoach:language-changed', refresh);
  window.addEventListener('gamecoach:sync-failed', () => { $('#ai-feedback').textContent = tr('服务器同步失败，本机修改仍保留；网络恢复后可重新连接。'); });
  refresh();
})();
