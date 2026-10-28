"use strict";

// Public deployment settings only. Never put keys or access codes in this file.
// Set an HTTPS origin such as https://YOUR-HOST.trycloudflare.com for GitHub Pages.
// Leave blank when Python serves both the page and API from the same origin.
window.GameCoachConfig = Object.freeze({
  apiBaseUrl: 'https://raspberrypi.taila8f0ba.ts.net',
  // 每次测试发布前更新；正式版本设为 '' 即可隐藏独立调试面板；不修改回答正文。
  testBuildLabel: 'debug-panel-v1'
});
