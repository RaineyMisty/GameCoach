'use strict';
// Credentials never enter GCStore, localStorage, exports, files, or URLs.
(() => {
  const $ = selector => document.querySelector(selector);
  let revision = 0; let currentGameId = 'lolm';
  function refresh() {
    const live = window.GameCoachAI.getProviderName() === 'gemini';
    $('#ai-state').textContent = live ? 'Gemini 已启用' : '演示模式';
    const game = window.GameCoachGames?.get(currentGameId);
    $('#provider-label').textContent = (game?.name || '英雄联盟手游') + (live ? ' · Google Gemini · 上下文将发送给 Gemini' : ' · 本地演示');
    $('#ai-settings-shortcut').textContent = live ? 'AI 设置' : '连接 AI';
    $('#test-ai').disabled = !live; $('#disconnect-ai').disabled = !live;
    $('#ai-connection-status').textContent = live ? 'Quick：Flash-Lite · 最低思考档；Coach：Flash · 中等思考。密钥仅当前页面有效。' : '尚未连接真实 AI，当前回复是本地演示。';
  }
  function changing() {
    revision++;
    window.dispatchEvent(new Event('gamecoach:ai-changing'));
  }
  $('#ai-settings-shortcut').onclick = () => {
    $('#account-open').click();
    $('#ai-connection-section').scrollIntoView({ block: 'start' });
    $('#gemini-api-key').focus();
  };
  $('#ai-connection-form').onsubmit = e => {
    e.preventDefault();
    try {
      const key = $('#gemini-api-key').value;
      changing(); window.GameCoachGemini.activate(key); $('#gemini-api-key').value = '';
      refresh(); $('#ai-feedback').textContent = '已启用 Gemini。可以测试连接，或关闭此面板后直接发问。';
    } catch (error) { $('#gemini-api-key').value = ''; $('#ai-feedback').textContent = error.message; }
  };
  $('#disconnect-ai').onclick = () => {
    changing(); window.GameCoachGemini.disconnect(); $('#gemini-api-key').value = '';
    refresh(); $('#ai-feedback').textContent = '已清除当前页面的密钥，切回演示模式。';
  };
  $('#test-ai').onclick = async () => {
    const current = revision;
    $('#test-ai').disabled = true; $('#ai-feedback').textContent = '正在测试连接…';
    try {
      await window.GameCoachGemini.testConnection();
      if (current === revision) $('#ai-feedback').textContent = '密钥与两个模型信息可访问。请发送一条消息验证实际生成和额度；此测试未生成回复。';
    } catch (error) { if (current === revision) $('#ai-feedback').textContent = error.message; }
    finally { if (current === revision) $('#test-ai').disabled = !window.GameCoachGemini.isConfigured(); }
  };
  window.addEventListener('gamecoach:game-changed', event => { currentGameId = event.detail.gameId; refresh(); });
  refresh();
})();
