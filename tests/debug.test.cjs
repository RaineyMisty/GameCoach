const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/debug.js'), 'utf8');
test('debug panel displays only version and request metadata without mutating the response', () => {
  const elements = Object.fromEntries(['debug-panel', 'debug-build', 'debug-request'].map(id => [id, {hidden: true, textContent: ''}]));
  const ctx = {window: {GameCoachConfig: {testBuildLabel: 'build-one'}}, document: {getElementById: id => elements[id]}};
  vm.createContext(ctx); vm.runInContext(source, ctx);
  const debug = ctx.window.GameCoachDebug;
  assert.equal(elements['debug-panel'].hidden, false); assert.equal(elements['debug-build'].textContent, 'Build build-one');
  debug.start('coach'); assert.equal(elements['debug-request'].textContent, 'Coach · pending');
  const response = {mode: 'coach', provider: 'backend', upstreamProvider: 'deepseek', model: 'example-model', timings: {totalMs: 123.4}, content: 'private answer'};
  const before = JSON.stringify(response); debug.finish(response);
  assert.equal(elements['debug-request'].textContent, 'Coach · deepseek · example-model · 123 ms');
  assert.equal(JSON.stringify(response), before);
  assert.ok(!elements['debug-request'].textContent.includes(response.content));
  debug.fail({name: 'AbortError'}); assert.equal(elements['debug-request'].textContent, 'cancelled');
});
test('empty build label hides the panel and its callbacks are harmless', () => {
  const panel = {hidden: true};
  const ctx = {window: {GameCoachConfig: {testBuildLabel: ''}}, document: {getElementById: () => panel}};
  vm.createContext(ctx); vm.runInContext(source, ctx);
  ctx.window.GameCoachDebug.start('quick'); ctx.window.GameCoachDebug.finish({}); ctx.window.GameCoachDebug.fail({});
  assert.equal(panel.hidden, true); assert.equal(panel.textContent, undefined);
});
