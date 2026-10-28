const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, '..');

function setup({ saved = new Map(), blocked = false, apiBaseUrl = '', pageOrigin = 'http://localhost' } = {}) {
  const requests = [];
  let stateVersion = 0;
  let user = { id: 'local-user-1', name: '玩家', profile: { rank: 'Gold' } };
  let chatStatus = 200;
  const ctx = {
    window: { location: new URL(pageOrigin), GameCoachConfig: { apiBaseUrl } },
    structuredClone, setTimeout, clearTimeout, AbortController, DOMException, performance, crypto, URL,
    sessionStorage: {
      getItem: key => { if (blocked) throw Error('blocked'); return saved.get(key); },
      setItem: (key, value) => { if (blocked) throw Error('blocked'); saved.set(key, value); },
      removeItem: key => saved.delete(key),
    },
    async fetch(url, options) {
      const endpoint = new URL(url, pageOrigin).pathname;
      requests.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
      const data = endpoint === '/api/user-state' ? (options.method === 'PUT' ? {version: ++stateVersion} : {version: stateVersion, user: null})
        : endpoint === '/api/providers' ? {default_provider: 'gemini'}
        : endpoint === '/api/health' ? { model_configured: true }
        : ['/api/sessions', '/api/sessions/restore'].includes(endpoint) ? { token: 'token-' + user.id, expires_at: Date.now() / 1000 + 3600, recovery: 'recovery-' + user.id }
        : endpoint === '/api/conversations' ? { conversation_id: 'remote-chat-' + requests.length }
        : { content: 'answer', model: 'actual-server-model', finishReason: 'stop',
          upstream_provider: options.body ? JSON.parse(options.body).provider || 'gemini' : undefined };
      return { ok: url !== '/api/chat' || chatStatus === 200, status: url === '/api/chat' ? chatStatus : 200,
        json: async () => data };
    },
  };
  vm.createContext(ctx);
  for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js', 'frontend/draft.js',
    'memory/defaults.js', 'memory/index.js', 'memory/retrieve.js', 'ai-core/demo.js', 'ai-core/index.js', 'skill/index.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  ctx.window.GCStore = { current: () => user, users: () => [user], select() {},
    restoreSnapshot: value => { user = value; } };
  ctx.window.GameCoachGemini = { disconnect: () => ctx.window.GameCoachAI.configure({ provider: 'demo' }) };
  vm.runInContext(fs.readFileSync(path.join(root, 'ai-core/backend.js'), 'utf8'), ctx);
  const conversation = id => ({ id, userId: user.id, user: { name: user.name, profile: user.profile } });
  return { ctx, requests, saved, conversation, setUser: value => { user = value; },
    failChat: status => { chatStatus = status; }, ...ctx.window };
}

test('backend sends only the current Skill context and uses server-returned model metadata', async () => {
  const w = setup(), deltas = [];
  await w.GameCoachBackend.testConnection(); w.GameCoachBackend.activate();
  const response = await w.GameCoachSkill.run([
    { role: 'user', content: 'old browser question' }, { role: 'assistant', content: 'old browser answer' },
    { role: 'user', content: '选什么辅助？' },
  ], { context: { draft: { ally: ['ashe'] }, searchMode: 'on' }, mode: 'coach',
    conversation: w.conversation('local-chat-1'), onDelta: value => deltas.push(value) });
  const request = w.requests.find(item => item.url === '/api/chat');
  assert.equal(request.body.message, '选什么辅助？');
  assert.equal(request.body.mode, 'coach');
  assert.match(request.body.context, /艾希/);
  assert.ok(!JSON.stringify(request.body).includes('old browser'));
  assert.ok(!Object.hasOwn(request.body, 'history'));
  assert.equal(request.headers.Authorization, 'Bearer token-local-user-1');
  assert.ok(!JSON.stringify(request).includes('x-goog-api-key'));
  assert.equal(response.model, 'actual-server-model');
  assert.equal(response.isDemo, false); assert.equal(response.provider, 'backend');
  assert.deepEqual(deltas, ['answer']);
});

test('conversations and local users have independent server identities, including after refresh', async () => {
  const w = setup(); w.GameCoachBackend.activate();
  for (const id of ['chat-a', 'chat-a', 'chat-b']) {
    await w.GameCoachSkill.run('hi', { conversation: w.conversation(id) });
  }
  assert.equal(w.requests.filter(item => item.url === '/api/sessions').length, 1);
  assert.equal(w.requests.filter(item => item.url === '/api/conversations').length, 2);
  const payloads = w.requests.filter(item => item.url === '/api/chat');
  assert.equal(payloads[0].body.conversation_id, payloads[1].body.conversation_id);
  assert.notEqual(payloads[0].body.request_id, payloads[1].body.request_id);
  const refreshed = setup({ saved: w.saved }); refreshed.GameCoachBackend.activate();
  await refreshed.GameCoachSkill.run('continued', { conversation: refreshed.conversation('chat-a') });
  assert.equal(refreshed.requests.filter(item => item.url === '/api/sessions' || item.url === '/api/conversations').length, 0);
  assert.equal(refreshed.requests.find(item => item.url === '/api/chat').body.conversation_id, payloads[0].body.conversation_id);
  w.setUser({ id: 'local-user-2', name: '另一个用户', profile: {} });
  await w.GameCoachSkill.run('hi', { conversation: w.conversation('chat-a') });
  assert.equal(w.requests.at(-1).headers.Authorization, 'Bearer token-local-user-2');
});

test('invalid sessions fail visibly without automatic retry or fallback', async () => {
  const w = setup(), deltas = []; w.GameCoachBackend.activate(); w.failChat(401);
  await assert.rejects(w.GameCoachSkill.run('hi', { conversation: w.conversation('chat'), onDelta: value => deltas.push(value) }), /会话已失效/);
  assert.equal(w.requests.filter(item => item.url === '/api/chat').length, 1);
  assert.equal(w.GameCoachBackend.isActive(), true); assert.deepEqual(deltas, []);
});

test('all five providers use one chat endpoint, preserving the same server conversation', async () => {
  const w = setup();
  for (const name of ['gemini', 'deepseek', 'openai', 'grok', 'claude']) {
    await w.GameCoachBackend.testConnection(name); w.GameCoachBackend.activate(name);
    const response = await w.GameCoachSkill.run('hi', { conversation: w.conversation('chat') });
    assert.equal(w.requests.at(-1).url, '/api/chat');
    assert.equal(w.requests.at(-1).body.provider, name);
    assert.equal(response.upstreamProvider, name);
    assert.ok(w.requests.some(item => item.url === '/api/connection?provider=' + name));
  }
  assert.equal(w.requests.filter(item => item.url === '/api/sessions').length, 1);
  assert.equal(w.requests.filter(item => item.url === '/api/conversations').length, 1);
  assert.throws(() => w.GameCoachBackend.activate('unsupported'), /请选择/);
});

test('a user Key is sent once to the authenticated backend and is absent from browser persistence', async () => {
  const w = setup();
  w.setUser({id:'local-user-1',name:'玩家',profile:{},memory:{version:1,enabled:true,entries:[{id:'m1',title:'training',text:'shared preference'}]}});
  await w.GameCoachBackend.connect({provider:'deepseek',apiKey:'private-api-key',accessCode:'team-access'});
  const savedKey = w.requests.find(item => item.url === '/api/credentials/deepseek');
  assert.equal(savedKey.body.api_key,'private-api-key');
  assert.equal(savedKey.headers.Authorization,'Bearer token-local-user-1');
  assert.equal(w.requests.find(item=>item.url === '/api/sessions').headers['X-GameCoach-Access'],'team-access');
  assert.equal(w.requests.filter(item=>(JSON.stringify(item.body) || '').includes('private-api-key')).length,1);
  assert.ok(!JSON.stringify([...w.saved]).includes('private-api-key'));
  assert.ok(!JSON.stringify([...w.saved]).includes('team-access'));
  assert.ok(w.requests.every(item=>item.url.startsWith('/api/')));
  const state = w.requests.find(item=>item.url === '/api/user-state' && item.method === 'PUT');
  assert.equal(state.body.user.memory.entries[0].text,'shared preference');
});

test('credentials are never transmitted from a non-HTTPS remote website', async () => {
  const w=setup(); w.ctx.window.location={protocol:'http:',hostname:'remote.example.com',origin:'http://remote.example.com'};
  await assert.rejects(w.GameCoachBackend.connect({provider:'deepseek',apiKey:'private-key',accessCode:'team-access'}),/HTTPS/);
  assert.equal(w.requests.length,0);
});

test('backend displays only recognized safe network diagnostics', async () => {
  const w = setup();
  const original = w.ctx.fetch;
  w.ctx.fetch = async (url, options) => url === '/api/connection'
    ? { ok: false, status: 502, json: async () => ({ detail: { code: 'UPSTREAM_DNS_ERROR', message: 'secret' } }) }
    : original(url, options);
  await assert.rejects(w.GameCoachBackend.testConnection(), error =>
    /UPSTREAM_DNS_ERROR/.test(error.message) && !error.message.includes('secret'));
  w.ctx.fetch = async () => ({ ok: false, status: 502,
    json: async () => ({ detail: { code: 'secret', message: 'secret' } }) });
  await assert.rejects(w.GameCoachBackend.testConnection(), error => !error.message.includes('secret'));
  w.ctx.fetch = async (url, options) => url === '/api/connection'
    ? { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
    : original(url, options);
  await assert.rejects(w.GameCoachBackend.testConnection(), /重启.*Python/);
});

test('blocked session storage still permits chatting in the current page', async () => {
  const w = setup({ blocked: true }); w.GameCoachBackend.activate();
  await w.GameCoachSkill.run('hi', { conversation: w.conversation('chat') });
  await w.GameCoachSkill.run('again', { conversation: w.conversation('chat') });
  assert.equal(w.requests.filter(item => item.url === '/api/sessions').length, 1);
});

test('cancellation reaches the API request and ignores late returned text', async () => {
  const w = setup(), controller = new AbortController(), deltas = []; w.GameCoachBackend.activate();
  const original = w.ctx.fetch;
  let started, finish;
  const pending = new Promise(resolve => { started = resolve; });
  w.ctx.fetch = async (url, options) => {
    if (url !== '/api/chat') return original(url, options);
    started(options.signal);
    await new Promise(resolve => { finish = resolve; });
    return { ok: true, status: 200, json: async () => ({ content: 'late text' }) };
  };
  const response = w.GameCoachSkill.run('hi', { conversation: w.conversation('chat'), signal: controller.signal,
    onDelta: value => deltas.push(value) });
  const signal = await pending; controller.abort();
  await assert.rejects(response, { name: 'AbortError' });
  assert.equal(signal.aborted, true); finish(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(deltas, []);
});

test('Pages sends all requests only to the configured HTTPS backend without redirects or cookies', async () => {
  const w = setup({ apiBaseUrl: 'https://coach.example.com', pageOrigin: 'https://team.github.io' });
  await w.GameCoachBackend.connect({provider:'deepseek',apiKey:'private-key',accessCode:'team-access'});
  w.GameCoachBackend.activate('deepseek');
  await w.GameCoachSkill.run('hi', { conversation: w.conversation('remote-chat') });
  assert.ok(w.requests.every(item => item.url.startsWith('https://coach.example.com/api/')));
  assert.ok(w.requests.every(item => item.credentials === 'omit' && item.redirect === 'error' && item.referrerPolicy === 'no-referrer'));
  assert.ok(w.requests.some(item => item.url === 'https://coach.example.com/api/chat'));
  // Configuration is captured at load; changing it later cannot redirect an existing token.
  w.ctx.window.GameCoachConfig.apiBaseUrl = 'https://other.example.com';
  await w.GameCoachBackend.testConnection('deepseek');
  assert.ok(w.requests.every(item => item.url.startsWith('https://coach.example.com/api/')));
});

test('unsafe backend origins are rejected before transmitting a key or access code', async () => {
  for (const apiBaseUrl of ['http://remote.example.com', 'https://user:password@coach.example.com',
    'https://coach.example.com/api', 'https://coach.example.com?key=private', 'https://coach.example.com#api',
    '//coach.example.com', 'javascript:alert(1)', 123, 'http://localhost:8000']) {
    const w = setup({apiBaseUrl, pageOrigin:'https://team.github.io'});
    await assert.rejects(w.GameCoachBackend.connect({provider:'deepseek',apiKey:'private-key',accessCode:'private-code'}), /HTTPS/);
    assert.equal(w.requests.length, 0);
  }
});

test('sessions are scoped to the API origin and legacy tokens never move to a remote server', async () => {
  const saved = new Map([['gamecoach-backend-session:local-user-1', JSON.stringify({token:'legacy-token', conversations:{}})]]);
  const first = setup({saved, apiBaseUrl:'https://a.example.com', pageOrigin:'https://team.github.io'});
  await first.GameCoachBackend.connect({provider:'deepseek'});
  assert.ok(first.requests.every(item => item.headers.Authorization !== 'Bearer legacy-token'));
  const second = setup({saved, apiBaseUrl:'https://b.example.com', pageOrigin:'https://team.github.io'});
  await second.GameCoachBackend.connect({provider:'deepseek'});
  assert.ok(second.requests.some(item => item.url === 'https://b.example.com/api/sessions'));
  assert.equal([...saved.keys()].filter(key => key.includes('v2:')).length, 2);
  const refreshed = setup({saved, apiBaseUrl:'https://a.example.com', pageOrigin:'https://team.github.io'});
  await refreshed.GameCoachBackend.connect({provider:'deepseek'});
  assert.ok(!refreshed.requests.some(item => item.url === 'https://a.example.com/api/sessions'));
});

test('same-origin clients migrate existing session storage without creating a new server user', async () => {
  const saved = new Map([['gamecoach-backend-session:local-user-1', JSON.stringify({token:'legacy-token',
    expires_at:Date.now()/1000+1000, conversations:{}})]]);
  const w = setup({saved});
  await w.GameCoachBackend.testConnection();
  assert.equal(w.requests[0].headers.Authorization, 'Bearer legacy-token');
  assert.ok(!saved.has('gamecoach-backend-session:local-user-1'));
  assert.equal(JSON.parse([...saved.values()][0]).server, 'http://localhost');
});

test('private recovery is bound to the backend and rejects other servers before sending a secret', async () => {
  const w = setup({apiBaseUrl:'https://a.example.com', pageOrigin:'https://team.github.io'});
  await w.GameCoachBackend.connect({provider:'deepseek'});
  const file = w.GameCoachBackend.recoveryFile();
  assert.equal(file.version, 2); assert.equal(file.server, 'https://a.example.com');
  const other = setup({apiBaseUrl:'https://b.example.com', pageOrigin:'https://team.github.io'});
  await assert.rejects(other.GameCoachBackend.restoreAccess(file, 'private-code'), /私有恢复文件/);
  assert.equal(other.requests.length, 0);
  await assert.rejects(w.GameCoachBackend.restoreAccess({...file, version:1, server:'https://team.github.io'}), /私有恢复文件/);
  // A new page origin can restore access to the same backend using the explicit v2 file.
  const movedPage = setup({apiBaseUrl:'https://a.example.com', pageOrigin:'https://other.github.io'});
  await movedPage.GameCoachBackend.restoreAccess(file, 'private-code');
  const restore = movedPage.requests.find(item => item.url === 'https://a.example.com/api/sessions/restore');
  assert.equal(restore.body.recovery, file.recovery);
  assert.equal(restore.headers['X-GameCoach-Access'], 'private-code');
  const same = setup({pageOrigin:'https://a.example.com'});
  await same.GameCoachBackend.restoreAccess({...file, version:1});
  assert.ok(same.requests.some(item => item.url === '/api/sessions/restore'));
});

test('GitHub Pages without a backend address keeps secrets local and explains setup', async () => {
  const w = setup({pageOrigin:'https://team.github.io'});
  await assert.rejects(w.GameCoachBackend.connect({provider:'deepseek',apiKey:'private-key'}), /frontend\/config.js/);
  assert.equal(w.requests.length, 0);
});
