const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..');
function setup({saved = new Map(), origin = 'https://api.example', userId = 'user-one', fail = false, blocked = false, wait} = {}) {
  const elements = new Map(), calls = [], listeners = new Map();
  const user = {id: userId};
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {value: '', textContent: '', disabled: false, focus() {}, click() {}, scrollIntoView() {}});
    return elements.get(selector);
  };
  let active = false;
  const api = {getApiOrigin: () => origin, isActive: () => active, getProviderName: () => 'deepseek',
    async connect(options) {calls.push(structuredClone(options)); if (wait) await wait; if (fail) throw Error('connection failed'); return {provider: options.provider || 'deepseek'};},
    activate(provider) {active = true; calls.push(provider);}, disconnect() {active = false;},
    async testConnection() {}, async forgetKey(provider) {calls.push({forgot: provider});}};
  const ctx = {Event, structuredClone,
    localStorage: {getItem: key => {if (blocked) throw Error('blocked'); return saved.get(key) ?? null;},
      setItem: (key, value) => {if (blocked) throw Error('blocked'); saved.set(key, value);}},
    document: {querySelector: element}, window: {GameCoachBackend: api, GCStore: {current: () => user},
      GameCoachGames: {get: () => ({name: 'Game'})},
      addEventListener: (name, handler) => listeners.set(name, handler), dispatchEvent() {}}};
  vm.createContext(ctx);
  for (const file of ['frontend/api-preferences.js', 'frontend/ai-settings.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {filename: file});
  return {ctx, api, calls, saved, user, element, listeners, ready: ctx.window.GameCoachApiSettings.ready,
    submit: () => element('#ai-connection-form').onsubmit({preventDefault() {}})};
}
async function saveFirst(saved = new Map()) {
  const w = setup({saved}); await w.ready;
  w.element('#api-provider').value = 'deepseek'; w.element('#api-provider').onchange();
  w.element('#api-key').value = 'my-test-api-key'; w.element('#team-access-code').value = 'team-code';
  await w.submit(); return w;
}

test('manual submission saves the complete API panel and reload restores fields and connects automatically', async () => {
  const first = await saveFirst();
  assert.deepEqual(first.calls[0], {provider: 'deepseek', apiKey: 'my-test-api-key', accessCode: 'team-code'});
  assert.equal(first.element('#api-key').value, 'my-test-api-key');
  const before = JSON.stringify([...first.saved]);
  const reopened = setup({saved: first.saved}); await reopened.ready;
  assert.equal(reopened.element('#api-provider').value, 'deepseek');
  assert.equal(reopened.element('#api-key').value, 'my-test-api-key');
  assert.equal(reopened.element('#team-access-code').value, 'team-code');
  assert.equal(reopened.element('#search-mode').value, 'off');
  assert.deepEqual(reopened.calls[0], first.calls[0]); assert.equal(reopened.api.isActive(), true);
  assert.equal(JSON.stringify([...first.saved]), before);
});

test('editing is not saved until submit; provider-specific keys are preserved independently', async () => {
  const w = await saveFirst(); const before = JSON.stringify([...w.saved]);
  w.element('#api-provider').value = 'openai'; w.element('#api-provider').onchange();
  assert.equal(w.element('#api-key').value, ''); w.element('#api-key').value = 'openai-test-key';
  assert.equal(JSON.stringify([...w.saved]), before);
  await w.submit();
  w.element('#api-provider').value = 'deepseek'; w.element('#api-provider').onchange();
  assert.equal(w.element('#api-key').value, 'my-test-api-key');
  w.element('#api-key').value = 'updated-key'; await w.submit();
  const config = w.ctx.window.GameCoachApiPreferences.load();
  assert.equal(config.apiKeys.openai, 'openai-test-key'); assert.equal(config.apiKeys.deepseek, 'updated-key');
});

test('failed automatic reconnect preserves saved settings; disconnect keeps fields and disables auto-connect', async () => {
  const w = await saveFirst(); const before = JSON.stringify([...w.saved]);
  const failed = setup({saved: w.saved, fail: true}); await failed.ready;
  assert.equal(failed.element('#ai-feedback').textContent, 'connection failed');
  assert.equal(JSON.stringify([...w.saved]), before);
  assert.equal(failed.element('#api-key').value, 'my-test-api-key');
  failed.element('#disconnect-ai').onclick();
  const reopened = setup({saved: w.saved}); await reopened.ready;
  assert.equal(reopened.calls.length, 0); assert.equal(reopened.element('#api-key').value, 'my-test-api-key');
});

test('API settings are isolated by backend and user and deleting a key removes only that provider', async () => {
  const w = await saveFirst();
  for (const options of [{origin: 'https://other.example'}, {userId: 'other-user'}]) {
    const other = setup({saved: w.saved, ...options}); await other.ready;
    assert.equal(other.calls.length, 0); assert.equal(other.element('#api-key').value, '');
  }
  await w.element('#forget-api-key').onclick();
  assert.equal(w.ctx.window.GameCoachApiPreferences.load().apiKeys.deepseek, undefined);
  const reopened = setup({saved: w.saved}); await reopened.ready;
  assert.equal(reopened.element('#api-key').value, ''); assert.equal(reopened.calls.length, 0);
});

test('editing or disconnecting during auto-connect prevents a late response from activating it', async () => {
  const first = await saveFirst();
  for (const action of ['edit', 'disconnect']) {
    const saved = new Map(first.saved); let release;
    const wait = new Promise(resolve => {release = resolve;});
    const w = setup({saved, wait});
    if (action === 'edit') {w.element('#api-key').value = 'unsaved'; w.element('#api-key').oninput();}
    else w.element('#disconnect-ai').onclick();
    release(); await w.ready;
    assert.equal(w.api.isActive(), false); assert.equal(w.element('#connect-api').disabled, false);
  }
});

test('user switch loads that user settings and blocked local storage still permits a manual connection', async () => {
  const w = await saveFirst();
  w.user.id = 'new-user'; w.listeners.get('gamecoach:user-updated')();
  assert.equal(w.element('#api-key').value, ''); assert.equal(w.api.isActive(), false);
  const blocked = setup({blocked: true}); await blocked.ready;
  blocked.element('#api-provider').value = 'deepseek'; blocked.element('#api-key').value = 'temporary-key';
  await blocked.submit(); assert.equal(blocked.api.isActive(), true);
  assert.match(blocked.element('#ai-feedback').textContent, /无法保存/);
});

test('database Default/Import controls remain separate and preferences load before the panel', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const database = html.slice(html.indexOf('id="local-database-section"'), html.indexOf('id="ai-connection-section"'));
  assert.match(database, /value="default">Default/); assert.match(database, /value="import">Import/);
  assert.ok(!database.includes('API Key<input'));
  assert.ok(html.indexOf('src="./api-preferences.js"') < html.indexOf('src="./ai-settings.js"'));
  assert.ok(!html.includes('src="../ai-core/gemini.js"'));
});
