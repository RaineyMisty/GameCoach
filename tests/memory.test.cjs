const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(seed = {}) {
  const saved = new Map(Object.entries(seed));
  const ctx = { window: {}, crypto: require('node:crypto').webcrypto, structuredClone, URL, setTimeout, clearTimeout, AbortController, DOMException, performance,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } };
  vm.createContext(ctx);
  for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js', 'frontend/draft.js',
    'memory/defaults.js', 'memory/index.js', 'memory/retrieve.js', 'memory/commands.js', 'frontend/storage.js', 'frontend/conversation.js',
    'ai-core/index.js', 'skill/rules.js', 'skill/input/game.js', 'skill/input/knowledge.js', 'skill/input/prepare.js', 'skill/output/index.js', 'skill/index.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  return { ...ctx.window, saved, ctx };
}
test('five requested directions and two supplementary memories seed once; new profiles do not assume support', () => {
  const w = setup(), user = w.GCStore.current(); assert.equal(user.profile.role, 'other');
  for (const id of ['analysis-support', 'analysis-jungle', 'analysis-carries', 'analysis-development', 'analysis-opponent']) assert.ok(user.memory.entries.some(item => item.id === id));
  assert.equal(user.memory.entries.length, 7);
  const next = w.GameCoachMemory.normalize({ version: 1, enabled: false, entries: [] }, { role: 'support' });
  assert.equal(next.entries.length, 0); assert.equal(next.enabled, false);
});
test('legacy profiles migrate into memory once without leaking arbitrary fields or regenerating deleted entries', () => {
  const w = setup(); const raw = { id: 'legacy', name: 'legacy', profile: { role: 'support', rank: 'Diamond', championPool: ['lulu'], apiKey: 'never-store-profile-secret' }, draft: {}, sessions: [] };
  const loaded = setup({ 'gamecoach-users-v2': JSON.stringify({ version: 2, activeId: 'legacy', users: [raw] }) });
  let user = loaded.GCStore.current(); assert.ok(user.memory.entries.some(item => item.id === 'profile-role'));
  assert.ok(!JSON.stringify(user.memory).includes('never-store')); user.memory = loaded.GameCoachMemory.remove(user.memory, 'profile-role'); loaded.GCStore.persist();
  const reloaded = setup(Object.fromEntries(loaded.saved)); user = reloaded.GCStore.current();
  assert.ok(!user.memory.entries.some(item => item.id === 'profile-role')); assert.equal(user.profile.role, 'support');
});
test('updating an unrelated profile field preserves edited/deleted memories and paused state', () => {
  const w = setup(), old = { role: 'support', rank: 'Diamond', preferences: '' };
  let memory = w.GameCoachMemory.normalize(undefined, old); memory.enabled = false;
  memory = w.GameCoachMemory.remove(memory, 'profile-role');
  const next = w.GameCoachMemory.withProfile(memory, { ...old, rank: 'Master' }, old);
  assert.equal(next.enabled, false); assert.ok(!next.entries.some(item => item.id === 'profile-role'));
  assert.match(next.entries.find(item => item.id === 'profile-rank').text, /Master/);
});
test('generic BP questions do not inject remembered roles or restrict the hero pool', () => {
  const w = setup(), memory = w.GameCoachMemory.normalize(undefined, { role: 'support', championPool: ['巴德', '锤石', '牛头'] });
  const selected = w.GameCoachMemoryRetrieval.select(memory, '选什么？');
  assert.ok(selected.entries.some(item => item.id === 'analysis-roles')); assert.ok(!selected.entries.some(item => item.id.startsWith('profile-')));
  assert.ok(!selected.text.includes('常用位置：辅助')); assert.ok(!selected.text.includes('巴德'));
  const personal = w.GameCoachMemoryRetrieval.select(memory, '结合我的英雄池推荐');
  assert.ok(personal.entries.some(item => item.id === 'profile-championPool'));
});
test('relevant directions are selected, casual chat stays free of analysis memories, and short follow-ups retain topic', () => {
  const w = setup(), memory = w.GameCoachMemory.seed();
  const jungle = w.GameCoachMemoryRetrieval.select(memory, '打野要投资上半区还是下半区？');
  assert.ok(jungle.entries.some(item => item.id === 'analysis-jungle')); assert.ok(!jungle.entries.some(item => item.id === 'analysis-support'));
  assert.equal(w.GameCoachMemoryRetrieval.select(memory, '谢谢你，你真聪明').text, '');
  assert.equal(w.GameCoachMemoryRetrieval.select(memory, '现在呢？', { draft: { ally: ['lulu'] } }).text, '');
  const follow = w.GameCoachMemoryRetrieval.select(memory, [{ role: 'user', content: '辅助怎么选？' }, { role: 'assistant', content: 'text' }, { role: 'user', content: '为什么？' }]);
  assert.ok(follow.entries.some(item => item.id === 'analysis-support'));
});
test('retrieval is bounded without truncating stored memories and disabled memory contributes nothing', () => {
  const w = setup(); let memory = w.GameCoachMemory.seed();
  for (let at = 0; at < 15; at++) memory = w.GameCoachMemory.save(memory, { text: '长期经验'.repeat(200), title: '经验' + at, topics: ['general'] });
  const before = plain(memory), selected = w.GameCoachMemoryRetrieval.select(memory, '选什么阵容？');
  assert.ok(selected.entries.length <= 6); assert.ok(selected.text.length < 1600); assert.deepEqual(plain(memory), before);
  memory.enabled = false; assert.equal(w.GameCoachMemoryRetrieval.select(memory, '选什么？').text, '');
});
test('memory edits, toggles, removal and document export preserve stable IDs and sanitize imported metadata', () => {
  const w = setup(); let memory = w.GameCoachMemory.seed(); const first = memory.entries[0];
  memory = w.GameCoachMemory.save(memory, { id: first.id, text: '修改后的经验', enabled: false });
  assert.equal(memory.entries[0].id, first.id); assert.equal(memory.entries[0].enabled, false);
  assert.match(w.GameCoachMemory.markdown(memory), /修改后的经验/);
  const cleaned = w.GameCoachMemory.normalize({ version: 1, entries: [{ id: '../secret', text: 'bad' }, { id: 'ok', text: 'good', apiKey: 'never', topics: ['system', 'jungle'] }] });
  assert.equal(cleaned.entries.length, 1); assert.deepEqual(plain(cleaned.entries[0].topics), ['jungle']); assert.ok(!JSON.stringify(cleaned).includes('never'));
});
test('explicit remember commands save/deduplicate locally; match stories alone do not update memories', () => {
  const w = setup(), before = w.GameCoachMemory.seed();
  let result = w.GameCoachMemoryCommands.apply(before, '记住：讨论辅助时，希望多探索大胆配合');
  assert.equal(result.handled, true); assert.equal(result.memory.entries.length, before.entries.length + 1);
  const last = result.memory.entries.at(-1); assert.equal(last.source, 'chat'); assert.deepEqual(plain(last.topics), ['support']);
  result = w.GameCoachMemoryCommands.apply(result.memory, '记住：讨论辅助时，希望多探索大胆配合'); assert.equal(result.memory.entries.length, before.entries.length + 1);
  assert.equal(w.GameCoachMemoryCommands.apply(before, '我这把男枪带惩戒赢了！').handled, false);
  const role = w.GameCoachMemoryCommands.apply(before, '记住：我常用位置是辅助').memory;
  assert.ok(!w.GameCoachMemoryRetrieval.select(role, '选什么').entries.some(item => item.id === role.entries.at(-1).id));
});
test('forget requires an unambiguous match and local receipts do not contaminate AI history', () => {
  const w = setup(), memory = w.GameCoachMemory.seed();
  const result = w.GameCoachMemoryCommands.apply(memory, '忘记：analysis-support'); assert.equal(result.memory.entries.length, 6);
  const ambiguous = w.GameCoachMemoryCommands.apply(memory, '忘记：可以'); assert.equal(ambiguous.memory.entries.length, 7);
  const history = w.GameCoachConversation.buildHistory([{ role: 'user', content: '记住：偏好', localOnly: true }, { role: 'coach', content: '已保存', localOnly: true }, { role: 'user', content: '选什么' }]);
  assert.equal(history.length, 1); assert.equal(history[0].content, '选什么');
});
test('memories survive reload and export/import, remain isolated between local users and preserve deleted defaults', () => {
  const w = setup(); const firstId = w.GCStore.current().id;
  w.GCStore.current().memory = w.GameCoachMemory.remove(w.GCStore.current().memory, 'analysis-support');
  w.GCStore.current().memory = w.GameCoachMemory.save(w.GCStore.current().memory, { title: '仅我的', text: '我的分析习惯', topics: ['general'] }); w.GCStore.persist();
  const backup = plain(w.GCStore.exportUser()); w.GCStore.create('second'); assert.ok(!JSON.stringify(w.GCStore.current().memory).includes('我的分析习惯'));
  w.GCStore.select(firstId); const reloaded = setup(Object.fromEntries(w.saved));
  assert.ok(!reloaded.GCStore.current().memory.entries.some(item => item.id === 'analysis-support'));
  assert.ok(JSON.stringify(reloaded.GCStore.current().memory).includes('我的分析习惯'));
  const imported = reloaded.GCStore.importBackup(backup); assert.notEqual(imported.id, firstId); assert.ok(JSON.stringify(imported.memory).includes('我的分析习惯'));
});
test('actual Skill request uses only selected user-level memories and reports the selected IDs without another call', async () => {
  const w = setup(); let seen, calls = 0;
  w.GameCoachAI.registerProvider('capture', { async generate(request) { calls++; seen = request; return { content: '建议' }; } }); w.GameCoachAI.configure({ provider: 'capture' });
  const answer = await w.GameCoachSkill.run('选什么？', { context: { draft: w.GameCoachDraft.empty(), memory: w.GCStore.current().memory, profile: { role: 'support', rank: 'never-direct-profile' } } });
  assert.equal(calls, 1); assert.ok(answer.usedMemories.length > 0);
  assert.equal(seen.input.filter(item => item.content.includes('【长期记忆')).length, 1);
  assert.ok(!seen.input.filter(item => item.role === 'system').some(item => item.content.includes('[analysis-')));
  assert.ok(!JSON.stringify(seen.input).includes('never-direct-profile')); assert.equal(seen.input.at(-1).content, '选什么？');
});

test('connected user folders persist memory inside the user JSON using the existing local-only writer', async () => {
  const w = setup(), written = new Map();
  w.ctx.window.showDirectoryPicker = async () => ({ name: 'memory-test-only', async getFileHandle(name, options) {
    if (!options?.create) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
    return { async createWritable() { return { async write(value) { written.set(name, JSON.parse(value)); }, async close() {}, async abort() {} }; } };
  } });
  await w.GCStore.connectFolder();
  const id = w.GCStore.current().id;
  assert.equal(written.get(id + '.json').user.memory.entries.length, 7);
  w.GCStore.current().memory = w.GameCoachMemory.save(w.GCStore.current().memory, { text: '本地文件夹同步验证', topics: ['general'] });
  w.GCStore.persist(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(written.get(id + '.json').user.memory.entries.some(item => item.text === '本地文件夹同步验证'));
});
