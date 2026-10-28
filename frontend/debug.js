"use strict";

// 仅显示当前页面版本及最近一次调用元信息；不读写正文、历史或浏览器存储。
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
  return Object.freeze({start, finish, fail});
})();
