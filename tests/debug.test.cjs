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


function inspectorSetup({saved = new Map(), enabled = true, userId = 'one'} = {}) {
  const ids = ['skill-debug-dialog', 'skill-debug-meta', 'skill-debug-input', 'skill-debug-prepared', 'skill-debug-close', 'skill-debug-copy'];
  const elements = Object.fromEntries(ids.map(id => [id, {textContent: '', opened: false, showModal() {this.opened = true;}, close() {this.opened = false;}}]));
  const user = {id: userId};
  const ctx = {structuredClone, sessionStorage: {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)},
    window: {GameCoachConfig: {skillDebugEnabled: enabled, testBuildLabel: 'inspect-one', apiBaseUrl: 'https://api.example'}, GCStore: {current: () => user}},
    document: {getElementById: id => elements[id]}};
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return {debug: ctx.window.GameCoachDebug, elements, user, saved};
}

test('each reply opens its captured Skill input, remains immutable and survives a same-tab reload', () => {
  const w = inspectorSetup();
  const snapshot = {stage: 'received', mode: 'coach', input: [{role: 'user', content: '<script>plain text</script>'}]};
  w.debug.capture('reply-one', 'one', snapshot);
  w.debug.capture('reply-one', 'one', {stage: 'prepared', messages: [{role: 'system', content: 'rules'}, {role: 'user', content: 'actual prompt'}]});
  snapshot.input[0].content = 'later change';
  w.debug.capture('reply-two', 'one', {stage: 'received', input: 'another question'});
  w.debug.open('reply-one');
  assert.equal(w.elements['skill-debug-dialog'].opened, true);
  assert.match(w.elements['skill-debug-input'].textContent, /plain text/);
  assert.ok(!w.elements['skill-debug-input'].textContent.includes('later change'));
  assert.match(w.elements['skill-debug-prepared'].textContent, /actual prompt/);
  const reopened = inspectorSetup({saved: w.saved}); reopened.debug.open('reply-two');
  assert.match(reopened.elements['skill-debug-input'].textContent, /another question/);
  reopened.user.id = 'two'; reopened.debug.open('reply-one');
  assert.equal(reopened.elements['skill-debug-input'].textContent, '');
  assert.match(reopened.elements['skill-debug-meta'].textContent, /没有 Skill 快照/);
});

test('production switch disables Skill capture and open, and traces retain only the latest twenty replies', () => {
  const off = inspectorSetup({enabled: false});
  assert.equal(off.debug.enabled, false);
  off.debug.capture('reply', 'one', {stage: 'received', input: 'not collected'}); off.debug.open('reply');
  assert.equal(off.saved.size, 0); assert.equal(off.elements['skill-debug-dialog'].opened, false);
  const on = inspectorSetup();
  for (let i = 0; i < 21; i++) on.debug.capture('reply-' + i, 'one', {stage: 'received', input: 'question-' + i});
  on.debug.open('reply-0'); assert.equal(on.elements['skill-debug-input'].textContent, '');
  on.debug.open('reply-20'); assert.match(on.elements['skill-debug-input'].textContent, /question-20/);
});
