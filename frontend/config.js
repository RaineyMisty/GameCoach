"use strict";

// Public deployment settings only. Never put keys or access codes in this file.
// Set an HTTPS origin such as https://YOUR-HOST.trycloudflare.com for GitHub Pages.
// Leave blank when Python serves both the page and API from the same origin.
window.GameCoachConfig = Object.freeze({
  apiBaseUrl: 'https://raspberrypi.taila8f0ba.ts.net',
  // 每次测试发布前更新；正式版本设为 ''，新回答便不再添加标识；旧回答保留原文。
  testBuildLabel: 'api-local-v4'
});
