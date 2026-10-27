const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..');

test('the universal API form submits only to the backend and immediately clears secrets', async () => {
  const elements = new Map(), calls = [], listeners = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', textContent: '', disabled: false,
      focus() {}, click() {}, scrollIntoView() {} });
    return elements.get(selector);
  };
  let active = false;
  const api = { isActive: () => active, getProviderName: () => 'deepseek',
    async connect(options) { calls.push(options); return {provider:'deepseek'}; },
    activate(provider) { active = true; calls.push(provider); }, disconnect() {active = false;},
    async testConnection() {}, async forgetKey() {} };
  const context = { Event, document: {querySelector:element}, window: { GameCoachBackend: api,
    GameCoachGames: {get:()=>({name:'Game'})},
    addEventListener: (name, handler) => listeners.set(name, handler), dispatchEvent: () => {} } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'frontend/ai-settings.js'),'utf8'),context);
  element('#api-provider').value = 'deepseek'; element('#api-key').value = 'private-key-not-for-storage';
  element('#team-access-code').value = 'private-team-access';
  const submitted = element('#ai-connection-form').onsubmit({preventDefault(){}});
  assert.equal(element('#api-key').value, ''); assert.equal(element('#team-access-code').value, '');
  await submitted;
  assert.equal(calls[0].apiKey, 'private-key-not-for-storage');
  assert.equal(calls[0].accessCode, 'private-team-access'); assert.equal(calls[0].provider, 'deepseek');
  assert.equal(calls[1], 'deepseek'); assert.equal(active,true);
  assert.match(element('#provider-label').textContent,/DeepSeek/);
  api.connect = async () => {throw Error('connection failed');};
  element('#api-key').value = 'another-private-key';
  await element('#ai-connection-form').onsubmit({preventDefault(){}});
  assert.equal(element('#api-key').value,''); assert.equal(element('#ai-feedback').textContent,'connection failed');
});

test('database Default/Import controls are separate from the universal API form', () => {
  const html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8');
  const database=html.slice(html.indexOf('id="local-database-section"'),html.indexOf('id="ai-connection-section"'));
  assert.match(database,/value="default">Default/); assert.match(database,/value="import">Import/);
  assert.ok(!database.includes('API Key<input'));
  assert.ok(html.includes('id="api-key"')); assert.ok(html.includes('id="api-provider"'));
  assert.ok(!html.includes('id="connect-backend"')); assert.ok(!html.includes('id="gemini-api-key"'));
  assert.ok(!html.includes('src="../ai-core/gemini.js"'));
});
