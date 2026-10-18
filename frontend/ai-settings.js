'use strict';
// Credentials never enter GCStore, localStorage, exports, files, or URLs.
(() => {
  const $ = selector => document.querySelector(selector);
  let revision = 0;
  function refresh() {
    const live = window.GameCoachAI.getProviderName() === 'groq';
    $('#ai-state').textContent = live ? 'Groq 已启用' : '演示模式';
    $('#provider-label').textContent = live ? 'Wild Rift · Groq / Qwen · 上下文将发送给 Groq' : 'Wild Rift · 本地演示';
    $('#ai-settings-shortcut').textContent = live ? 'AI 设置' : '连接 AI';
    $('#test-ai').disabled = !live; $('#disconnect-ai').disabled = !live;
    $('#ai-connection-status').textContent = live ? 'Quick：关闭思考 · Coach：中等思考。密钥仅当前页面有效。' : '尚未连接真实 AI，当前回复是本地演示。';
  }
  function changing() {
    revision++;
    window.dispatchEvent(new Event('gamecoach:ai-changing'));
  }
  $('#ai-settings-shortcut').onclick = () => {
    $('#account-open').click();
    $('#ai-connection-section').scrollIntoView({ block: 'start' });
    $('#groq-api-key').focus();
  };
  $('#ai-connection-form').onsubmit = e => {
    e.preventDefault();
    try {
      const key = $('#groq-api-key').value;
      changing(); window.GameCoachGroq.activate(key); $('#groq-api-key').value = '';
      refresh(); $('#ai-feedback').textContent = '已启用 Groq。可以测试连接，或关闭此面板后直接发问。';
    } catch (error) { $('#groq-api-key').value = ''; $('#ai-feedback').textContent = error.message; }
  };
  $('#disconnect-ai').onclick = () => {
    changing(); window.GameCoachGroq.disconnect(); $('#groq-api-key').value = '';
    refresh(); $('#ai-feedback').textContent = '已清除当前页面的密钥，切回演示模式。';
  };
  $('#test-ai').onclick = async () => {
    const current = revision;
    $('#test-ai').disabled = true; $('#ai-feedback').textContent = '正在测试连接…';
    try {
      await window.GameCoachGroq.testConnection();
      if (current === revision) $('#ai-feedback').textContent = '连接成功，Qwen 模型可用。此测试未生成聊天回复。';
    } catch (error) { if (current === revision) $('#ai-feedback').textContent = error.message; }
    finally { if (current === revision) $('#test-ai').disabled = !window.GameCoachGroq.isConfigured(); }
  };
  refresh();
})();
