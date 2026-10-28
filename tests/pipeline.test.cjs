const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.join(__dirname, '..');
function setup(seed = {}) {
  const saved = new Map(Object.entries(seed));
  const context = { window: {}, setTimeout, clearTimeout, AbortController, DOMException, performance, structuredClone, crypto, URL,
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) } };
  vm.createContext(context);
  for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js', 'frontend/draft.js',
    'memory/defaults.js', 'memory/index.js', 'memory/retrieve.js', 'memory/commands.js',
    'ai-core/demo.js', 'ai-core/index.js', 'skill/shared.js', 'skill/quick.js', 'skill/coach.js', 'skill/index.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return { core: context.window.GameCoachAI, skill: context.window.GameCoachSkill, context, saved };
}
test('Quick and Coach keep distinct execution settings and independent instructions', async () => {
  const { core, skill } = setup(); const calls = [];
  core.registerProvider('capture', { async generate(request) { calls.push(request); return { content: 'answer' }; } });
  core.configure({ provider: 'capture' });
  const messages = [{ role: 'user', content: 'any question' }];
  const context = { draft: { ally: ['lulu'] }, privateMarker: 'never add arbitrary context fields' };
  await skill.run(messages, { mode: 'quick', context });
  await skill.run(messages, { mode: 'coach', context });
  assert.equal(calls[0].model, 'demo-instant'); assert.equal(calls[0].reasoningEffort, 'none'); assert.equal(calls[0].maxOutputTokens, 128);
  assert.equal(calls[1].model, 'demo-reasoning'); assert.equal(calls[1].reasoningEffort, 'medium');
  assert.notEqual(calls[0].input[0].content, calls[1].input[0].content);
  assert.equal(calls[0].input[0].content, skill.quick.instructions);
  assert.equal(calls[1].input[0].content, skill.coach.instructions);
  assert.equal(JSON.stringify(calls[0].input.filter(item => item.role !== 'system')),
    JSON.stringify(calls[1].input.filter(item => item.role !== 'system')));
  assert.match(JSON.stringify(calls[0].input), /露露/); assert.ok(!JSON.stringify(calls[0].input).includes(context.privateMarker));
  assert.equal(calls[0].input.at(-1).content, messages[0].content);
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
  const conversation = calls[1].input.filter(message => message.role !== 'system' && !message.content.startsWith('【可选背景'));
  assert.equal(conversation.length, 3); assert.equal(conversation[1].content, 'first answer'); assert.equal(calls[1].reasoningEffort, 'medium');
});
test('new response metadata survives local storage and pending replies restore stopped', () => {
  const { context, saved } = setup();
  context.window.GAMECOACH_DATA = { champions: [] };
  vm.runInContext(fs.readFileSync(path.join(root, 'frontend/storage.js'), 'utf8'), context);
  let store = context.window.GCStore;
  store.current().sessions.push({ id: 's-1', title: 'test', created: '', messages: [
    { id: 'reply-1', role: 'coach', content: 'real', mode: 'coach', draft: { ally: [], enemy: [] }, provider: 'real-provider', model: 'custom', isDemo: false, status: 'complete', reasoningEffort: 'medium',
      attempts: 3, searched: true, inReplyTo: 'reply-previous', searchSuggestions: '<div>Suggestions</div>',
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 25 },
      usedMemories: [{ id: 'analysis-support', title: '辅助选人' }],
      sources: [{ title: '官方资料', url: 'https://example.org/hero', kind: 'web' }, { url: 'javascript:alert(1)' }] },
    { id: 'reply-2', role: 'coach', content: 'partial', mode: 'quick', draft: {}, status: 'pending' },
  ] }); store.persist();
  const next = setup(Object.fromEntries(saved)); next.context.window.GAMECOACH_DATA = { champions: [] };
  vm.runInContext(fs.readFileSync(path.join(root, 'frontend/storage.js'), 'utf8'), next.context); store = next.context.window.GCStore;
  const messages = store.current().sessions[0].messages;
  assert.equal(messages[0].isDemo, false); assert.equal(messages[0].provider, 'real-provider'); assert.equal(messages[0].reasoningEffort, 'medium');
  assert.equal(messages[1].status, 'cancelled');
  assert.equal(messages[0].attempts, 3); assert.equal(messages[0].inReplyTo, 'reply-previous');
  assert.equal(messages[0].sources.length, 1); assert.equal(messages[0].sources[0].url, 'https://example.org/hero');
  assert.equal(messages[0].searched, true); assert.equal(messages[0].usage.totalTokens, 25);
  assert.equal(messages[0].searchSuggestions, '<div>Suggestions</div>');
  assert.equal(messages[0].usedMemories[0].id, 'analysis-support');
});


test('Quick and Coach prepare independent windows from the same history and preset without modifying either', () => {
  const {skill, context} = setup();
  const draft = context.window.GameCoachDraft.empty();
  const memory = context.window.GameCoachMemory.seed();
  const messages = Array.from({length: 8}, (_, i) => [
    {role: 'user', content: 'support question ' + i, draft},
    {role: 'assistant', content: 'answer ' + i},
  ]).flat();
  messages.push({role: 'user', content: 'Which support should I pick?'});
  const presets = {draft, memory};
  const before = JSON.stringify({messages, presets});
  const quick = skill.quick.build(messages, presets);
  const coach = skill.coach.build(messages, presets);
  assert.notStrictEqual(skill.quick, skill.coach);
  assert.equal(quick.messages.filter(item => item.role === 'assistant').length, 8);
  assert.ok(coach.messages.filter(item => item.role === 'assistant').length < 8);
  assert.equal(quick.messages.at(-1).content, messages.at(-1).content);
  assert.equal(coach.messages.at(-1).content, messages.at(-1).content);
  assert.notEqual(skill.quick.instructions, skill.coach.instructions);
  assert.equal(JSON.stringify({messages, presets}), before);
  assert.equal(JSON.stringify(skill.prepare(messages, presets, {mode: 'quick'})), JSON.stringify(quick.messages));
  assert.equal(JSON.stringify(skill.prepare(messages, presets, {mode: 'coach'})), JSON.stringify(coach.messages));
  assert.throws(() => skill.prepare(messages, presets, {mode: 'unknown'}));
});


test('Skill inspection snapshots actual input and prepared messages without another model call or leaking callbacks', async () => {
  const {core, skill, context} = setup(); const snapshots = []; let seen, calls = 0;
  core.registerProvider('capture', {async generate(request) {calls++; seen = request; return {content: 'answer'};}});
  core.configure({provider: 'capture'});
  const draft = context.window.GameCoachDraft.empty(); draft.ally[0] = 'lulu';
  const input = [{role: 'user', content: 'question'}];
  await skill.run(input, {mode: 'coach', context: {draft, apiKey: 'never-in-debug'}, onInspect(value) {
    snapshots.push(structuredClone(value));
    if (value.stage === 'received') value.input[0].content = 'changed by inspector';
    if (value.stage === 'prepared') value.messages.at(-1).content = 'changed prepared copy';
  }});
  assert.equal(calls, 1); assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].input[0].content, 'question');
  assert.equal(snapshots[1].messages.at(-1).content, 'question');
  assert.equal(seen.input.at(-1).content, 'question');
  assert.equal(JSON.stringify(snapshots[1].messages), JSON.stringify(seen.input));
  assert.ok(!JSON.stringify(snapshots).includes('never-in-debug'));
  assert.ok(!Object.hasOwn(seen, 'onInspect'));
  input[0].content = 'later edit'; draft.ally[0] = 'ahri';
  assert.equal(snapshots[0].input[0].content, 'question');
  assert.equal(snapshots[0].context.draft.ally[0], 'lulu');
  const result = await skill.run('another question', {onInspect() {throw Error('debug failure');}});
  assert.equal(result.content, 'answer');
});


test('Quick uses its concise prompt in the actual call while preserving user wording and Coach policy', async () => {
  const {core, skill, context} = setup(); const calls = [];
  core.registerProvider('capture', {async generate(request) {calls.push(request); return {content: 'answer'};}});
  core.configure({provider: 'capture'});
  const coachBefore = skill.coach.instructions;
  for (const question of ['这局辅助出什么？', '我不会纳亚菲利，打野怎么开？', '啊哈哈']) {
    await skill.run(question, {mode: 'quick'});
    assert.equal(calls.at(-1).input[0].content, skill.quick.instructions);
    assert.equal(calls.at(-1).input.at(-1).content, question);
  }
  assert.equal(skill.coach.instructions, coachBefore);
  assert.equal(context.window.GameCoachSkillRules, undefined);
  assert.ok(!skill.quick.instructions.includes('Quick/Coach 是回答档位'));
  context.window.GameCoachI18n = {locale: 'en', t: key => key};
  await skill.run('Which support?', {mode: 'quick'});
  assert.match(calls.at(-1).input[0].content, /two or three seconds/);
  assert.ok(!/[\u3400-\u9fff]/.test(calls.at(-1).input[0].content));
});


test('Coach sends its independent teaching prompt without changing Quick or the current question', async () => {
  const {core, skill, context} = setup(); const calls = [];
  core.registerProvider('capture', {async generate(request) {calls.push(request); return {content: 'answer'};}});
  core.configure({provider: 'capture'});
  const quickBefore = skill.quick.instructions;
  for (const question of ['为什么这局选这个辅助？', '我觉得不行', '啊哈哈']) {
    await skill.run(question, {mode: 'coach'});
    assert.equal(calls.at(-1).input[0].content, skill.coach.instructions);
    assert.equal(calls.at(-1).input.at(-1).content, question);
    assert.equal(calls.at(-1).model, 'demo-reasoning');
  }
  assert.equal(skill.quick.instructions, quickBefore);
  assert.equal(context.window.GameCoachSkillRules, undefined);
  context.window.GameCoachI18n = {locale: 'en', t: key => key};
  await skill.run('Why this pick?', {mode: 'coach'});
  assert.equal(calls.at(-1).input[0].content, skill.coach.instructions);
  assert.ok(!/[\u3400-\u9fff]/.test(calls.at(-1).input[0].content));
});
