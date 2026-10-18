const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, '..');
function setup(seed = {}) {
  const saved = new Map(Object.entries(seed));
  const context = { window: {}, setTimeout, clearTimeout, AbortController, DOMException, performance, structuredClone, crypto,
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) } };
  vm.createContext(context);
  for (const file of ['ai-core/index.js', 'skill/index.js', 'frontend/draft.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return { core: context.window.GameCoachAI, skill: context.window.GameCoachSkill, context, saved };
}
test('Quick and Coach choose different execution settings, not prompt instructions', async () => {
  const { core, skill } = setup(); const calls = [];
  core.registerProvider('capture', { async generate(request) { calls.push(request); return { content: 'answer' }; } });
  core.configure({ provider: 'capture' });
  const messages = [{ role: 'user', content: 'any question' }];
  await skill.run(messages, { mode: 'quick', context: { draft: { ally: ['lulu'] }, privateMarker: 'never add to prompt in placeholder' } });
  await skill.run(messages, { mode: 'coach' });
  assert.equal(calls[0].model, 'demo-instant'); assert.equal(calls[0].reasoningEffort, 'none'); assert.equal(calls[0].maxOutputTokens, 128);
  assert.equal(calls[1].model, 'demo-reasoning'); assert.equal(calls[1].reasoningEffort, 'medium');
  assert.equal(JSON.stringify(calls[0].input), JSON.stringify(messages)); assert.equal(JSON.stringify(calls[1].input), JSON.stringify(messages));
  assert.equal('context' in calls[0], false); assert.equal('mode' in calls[0], false);
});
test('Skill forwards live text chunks before final response without a second call', async () => {
  const { core, skill } = setup(); const events = []; let count = 0; let finish;
  core.registerProvider('stream', { async generate({ onDelta }) {
    count++; onDelta('选'); events.push('provider waiting'); await new Promise(resolve => { finish = resolve; }); onDelta('露露'); return { content: '选露露' };
  } });
  core.configure({ provider: 'stream' });
  const response = skill.run('anything', { onDelta: text => events.push(text) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(events.join(','), '选,provider waiting'); finish();
  assert.equal((await response).content, '选露露'); assert.equal(count, 1); assert.equal(events.at(-1), '露露');
});
test('input is generic and supports multimodal parts without game fields', async () => {
  const { core } = setup(); let seen;
  core.registerProvider('generic', { async generate({ input }) { seen = input; return { content: 'generic' }; } }); core.configure({ provider: 'generic' });
  const input = [{ role: 'user', content: [{ type: 'text', text: 'inspect' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,test' } }] }];
  await core.call(input); assert.equal(JSON.stringify(seen), JSON.stringify(input));
});
test('cancel rejects non-cooperative providers and ignores late chunks', async () => {
  const { core } = setup(); let emit; const chunks = [];
  core.registerProvider('slow', { generate(request) { emit = request.onDelta; return new Promise(() => {}); } }); core.configure({ provider: 'slow' });
  const abort = new AbortController(); const response = core.call('hello', { signal: abort.signal, onDelta: x => chunks.push(x) });
  await Promise.resolve(); abort.abort(); await assert.rejects(response, { name: 'AbortError' }); emit('late'); assert.equal(chunks.length, 0);
});
test('timeout stays TimeoutError even when provider aborts cooperatively', async () => {
  const { core } = setup();
  core.registerProvider('slow', { generate({ signal }) { return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); } });
  core.configure({ provider: 'slow', modes: { quick: { timeoutMs: 10 } } });
  await assert.rejects(core.call('hello'), { name: 'TimeoutError' });
});
test('in-flight calls snapshot model settings and caller messages', async () => {
  const { core } = setup(); let seen; let finish;
  core.registerProvider('snapshot', { async generate(request) { seen = request; await new Promise(resolve => { finish = resolve; }); return { content: 'done' }; } }); core.configure({ provider: 'snapshot' });
  const input = [{ role: 'user', content: 'original' }]; const response = core.call(input);
  input[0].content = 'mutated'; core.configure({ modes: { quick: { model: 'replacement' } } }); await Promise.resolve();
  assert.equal(seen.input[0].content, 'original'); assert.equal(seen.model, 'demo-instant'); finish(); assert.equal((await response).model, 'demo-instant');
});
test('provider failures, malformed output and configuration errors are surfaced', async () => {
  const { core } = setup();
  core.registerProvider('bad', { async generate() { return { content: '' }; } }); core.configure({ provider: 'bad' }); await assert.rejects(core.call('hi'));
  core.registerProvider('mismatch', { async generate({ onDelta }) { onDelta('first'); return { content: 'different' }; } }); core.configure({ provider: 'mismatch' }); await assert.rejects(core.call('hi'));
  core.registerProvider('broken', { async generate() { throw new Error('provider failed'); } }); core.configure({ provider: 'broken' }); await assert.rejects(core.call('hi'), /provider failed/);
  const original = core.getProfile('quick'); assert.throws(() => core.configure({ modes: { quick: { model: 'changed' }, coach: { maxOutputTokens: -1 } } })); assert.equal(core.getProfile('quick').model, original.model);
  assert.throws(() => core.configure({ provider: 'missing' })); await assert.rejects(core.call('hi', { mode: 'missing' }));
});
test('same chat retains previous turns across Quick to Coach switch', async () => {
  const { core, skill } = setup(); const calls = [];
  core.registerProvider('history', { async generate(request) { calls.push(request); return { content: 'first answer' }; } }); core.configure({ provider: 'history' });
  const input = [{ role: 'user', content: 'first question' }]; const first = await skill.run(input, { mode: 'quick' });
  input.push({ role: 'assistant', content: first.content }, { role: 'user', content: 'explain' }); await skill.run(input, { mode: 'coach' });
  assert.equal(calls[1].input.length, 3); assert.equal(calls[1].input[1].content, 'first answer'); assert.equal(calls[1].reasoningEffort, 'medium');
});
test('new response metadata survives local storage and pending replies restore stopped', () => {
  const { context, saved } = setup();
  context.window.GAMECOACH_DATA = { champions: [] };
  vm.runInContext(fs.readFileSync(path.join(root, 'frontend/storage.js'), 'utf8'), context);
  let store = context.window.GCStore;
  store.current().sessions.push({ id: 's-1', title: 'test', created: '', messages: [
    { id: 'reply-1', role: 'coach', content: 'real', mode: 'coach', draft: { ally: [], enemy: [] }, provider: 'real-provider', model: 'custom', isDemo: false, status: 'complete', reasoningEffort: 'medium' },
    { id: 'reply-2', role: 'coach', content: 'partial', mode: 'quick', draft: {}, status: 'pending' },
  ] }); store.persist();
  const next = setup(Object.fromEntries(saved)); next.context.window.GAMECOACH_DATA = { champions: [] };
  vm.runInContext(fs.readFileSync(path.join(root, 'frontend/storage.js'), 'utf8'), next.context); store = next.context.window.GCStore;
  const messages = store.current().sessions[0].messages;
  assert.equal(messages[0].isDemo, false); assert.equal(messages[0].provider, 'real-provider'); assert.equal(messages[0].reasoningEffort, 'medium');
  assert.equal(messages[1].status, 'cancelled');
});
