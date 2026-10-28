const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function setup() {
  const ctx = { window: {}, structuredClone, AbortController, DOMException, performance, setTimeout, clearTimeout };
  vm.createContext(ctx);
  for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'resources/lol/knowledge.js',
    'resources/lolm/knowledge.js', 'frontend/data.js', 'frontend/draft.js', 'frontend/conversation.js', 'ai-core/demo.js', 'ai-core/index.js',
    'memory/defaults.js', 'memory/index.js', 'memory/retrieve.js', 'memory/commands.js',
    'skill/shared.js', 'skill/quick.js', 'skill/coach.js', 'skill/index.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  return { ...ctx.window, ctx };
}
test('official snapshots cover both catalogues with provenance and separate Corki mechanics', () => {
  const w = setup();
  for (const id of ['lol', 'lolm']) {
    const source = w.GAMECOACH_KNOWLEDGE[id];
    assert.equal(Object.keys(source.champions).length, w.GameCoachGames.get(id).champions.length);
    assert.equal(source.missing.length, 0); assert.ok(source.version); assert.ok(source.fetchedOn);
    for (const hero of Object.values(source.champions)) {
      assert.ok(hero.source.startsWith('https://')); assert.equal(hero.skills.length, 5);
      assert.ok(hero.skills.every(skill => skill.name && skill.text));
    }
  }
  assert.notDeepEqual(plain(w.GAMECOACH_KNOWLEDGE.lol.champions.corki.skills), plain(w.GAMECOACH_KNOWLEDGE.lolm.champions.corki.skills));
});
test('knowledge is relevant, source-labelled and budgeted rather than dumping the database', () => {
  const w = setup(), draft = w.GameCoachDraft.empty('lolm');
  const result = w.GameCoachSkillKnowledge.collect([{ role: 'user', content: '飞机辅助如何配合大虫子下路？' }], { draft });
  assert.match(result.text, /库奇/); assert.match(result.text, /科加斯/); assert.match(result.text, /官方技能快照/);
  assert.ok(!result.text.includes('盖伦')); assert.ok(result.text.length < 5000);
  assert.ok(result.sources.every(source => source.kind === 'local' && source.gameId === 'lolm'));
  assert.equal(w.GameCoachSkillKnowledge.collect([{ content: '现在呢？' }], { draft }).text, '');
  const followup = [{ role: 'user', content: '我玩飞机辅助' }, { role: 'assistant', content: '回答' }, { role: 'user', content: '前三级呢？' }];
  assert.match(w.GameCoachSkillKnowledge.collect(followup, { draft }).text, /库奇/);
  followup.at(-1).content = '现在呢？'; assert.equal(w.GameCoachSkillKnowledge.collect(followup, { draft }).text, '');
  const heroes = w.GameCoachGames.get('lolm').champions.slice(0, 10).map(hero => hero.id);
  draft.ally = heroes.slice(0, 5); draft.enemy = heroes.slice(5);
  const team = w.GameCoachSkillKnowledge.collect([{ role: 'user', content: '分析这套阵容' }], { draft });
  assert.equal(team.sources.length, 10); assert.ok(team.text.length < 5000);
});
test('auto search reacts to freshness requests but not casual chat or the word now', () => {
  const { GameCoachSkillKnowledge: kb } = setup();
  for (const question of ['查一下最新版库奇技能', '核实当前版本装备', 'latest patch Corki']) assert.equal(kb.wantsSearch(question), true);
  for (const question of ['现在呢', '你好', '飞机辅助怎么打', '快速模式是什么']) assert.equal(kb.wantsSearch(question), false);
  assert.equal(kb.wantsSearch('你好', 'on'), true); assert.equal(kb.wantsSearch('查一下', 'off'), false);
});
test('expansion binds the clicked answer and its original question without mutating the current draft', () => {
  const w = setup(), old = w.GameCoachDraft.empty('lolm'), current = w.GameCoachDraft.empty('lol');
  old.ally[4] = 'corki'; current.ally[4] = 'lulu'; const before = plain(current);
  const messages = [{ role: 'user', content: '我用飞机辅助', draft: old },
    { id: 'a1', role: 'coach', content: '先用消耗换线权', status: 'complete' },
    { role: 'user', content: '谢谢', draft: current }, { id: 'a2', role: 'coach', content: '不客气', status: 'complete' }];
  const expansion = w.GameCoachConversation.expansion(messages, 'a1');
  assert.equal(expansion.question, '我用飞机辅助'); assert.equal(expansion.answer, '先用消耗换线权');
  assert.equal(expansion.draft.ally[4], 'corki'); assert.deepEqual(plain(current), before);
  const packed = w.GameCoachSkill.prepare([...w.GameCoachConversation.buildHistory(messages), { role: 'user', content: '展开解释' }], { draft: expansion.draft, expansion });
  const target = packed.findIndex(message => message.content === expansion.answer);
  assert.match(packed[target - 1].content, /深入解释目标/);
  assert.equal(packed.at(-1).content, '展开解释');
});
test('old answers outside the history window and legacy answers without IDs can still be expanded', () => {
  const w = setup(); const messages = [{ role: 'user', content: '原问题', draft: w.GameCoachDraft.empty() }, { role: 'coach', content: '原答案' }];
  const expansion = w.GameCoachConversation.expansion(messages, messages[1]);
  const result = w.GameCoachSkill.prepare('解释', { expansion });
  assert.ok(result.some(message => message.content.includes('被点击的回答："原答案"')));
  assert.throws(() => w.GameCoachConversation.expansion([{ id: 'x', role: 'coach', status: 'error' }], 'x'), /尚未完成/);
});
test('failed and demo replies are excluded but failure events and explicit user conditions survive', () => {
  const w = setup(), messages = [
    { role: 'user', content: '我用飞机辅助，不换' }, { role: 'coach', content: '演示', isDemo: true, status: 'complete' },
    { role: 'user', content: '不是中单，我就是辅助' }, { role: 'coach', content: '生成失败：网络', status: 'error' }];
  const history = w.GameCoachConversation.buildHistory(messages);
  assert.ok(history.every(message => message.role === 'user'));
  const result = w.GameCoachSkill.prepare([...history, { role: 'user', content: '现在呢？' }], {
    lastCall: w.GameCoachConversation.lastCall(messages), declarations: w.GameCoachConversation.declarations(messages) });
  const packed = result.map(message => message.content).join('\n');
  assert.match(packed, /上一请求未能完成/); assert.match(packed, /没有完整回答/); assert.match(packed, /我用飞机辅助，不换/);
  assert.ok(w.GameCoachConversation.declarations(messages).includes('不是中单，我就是辅助'));
  assert.equal(result.at(-1).content, '现在呢？'); assert.ok(!packed.includes('生成失败：网络'));
});
test('Skill sends grounded context once and propagates sources and actual retrieval settings', async () => {
  const w = setup(), calls = []; const draft = w.GameCoachDraft.empty('lolm');
  w.GameCoachAI.registerProvider('capture', { async generate(request) { calls.push(request); return { content: '分析', sources: [{ url: 'https://example.org/', kind: 'web' }], searched: true }; } });
  w.GameCoachAI.configure({ provider: 'capture' });
  const answer = await w.GameCoachSkill.run('查一下飞机技能', { context: { draft } });
  assert.equal(calls.length, 1); assert.equal(calls[0].webSearch, true);
  assert.equal(calls[0].input.filter(message => message.content.includes('【官方技能快照')).length, 1);
  assert.ok(answer.sources.some(source => source.kind === 'local')); assert.ok(answer.sources.some(source => source.kind === 'web'));
  await assert.rejects(w.GameCoachSkill.run(null), /请输入/);
});
