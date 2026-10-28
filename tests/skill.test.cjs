const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(extra = {}) {
  const context = { window: {}, setTimeout, clearTimeout, AbortController, DOMException, performance, structuredClone, TextDecoder, ...extra };
  vm.createContext(context);
  for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js', 'frontend/draft.js',
    'memory/defaults.js', 'memory/index.js', 'memory/retrieve.js', 'memory/commands.js',
    'ai-core/demo.js', 'ai-core/index.js', 'skill/shared.js', 'skill/quick.js', 'skill/coach.js', 'skill/index.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return { context, skill: context.window.GameCoachSkill, core: context.window.GameCoachAI, ops: context.window.GameCoachDraft };
}
const text = messages => messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n');

test('basic context includes the selected game, picks and active bans without assets or the whole catalogue', () => {
  const { skill, ops } = setup(); let draft = ops.setBPMode(ops.empty('lolm'), true);
  draft = ops.assign(draft, 'jinx', { side: 'ally', index: 4 });
  draft = ops.assign(draft, 'akali', { side: 'enemy', index: 1 });
  draft = ops.assignBan(draft, 'ahri', { side: 'enemy', index: 0, kind: 'ban' });
  const result = skill.prepare('这套阵容怎么打？', { draft }); const packed = text(result);
  assert.match(packed, /游戏：英雄联盟手游/); assert.match(packed, /蓝选：5=金克丝/);
  assert.match(packed, /红选：2=阿卡丽/); assert.match(packed, /红禁：阿狸/);
  assert.ok(!packed.includes('辅助=金克丝')); assert.ok(!packed.includes('resources/'));
  assert.ok(!packed.includes('sourcePortrait')); assert.ok(!packed.includes('亚托克斯'));
  assert.equal(result.at(-1).content, '这套阵容怎么打？');
});

test('normal lineup positions and mirror picks survive while unknown heroes and inactive bans are omitted', () => {
  const { skill, ops } = setup(); const draft = ops.empty('lol');
  draft.ally[2] = 'ahri'; draft.enemy[4] = 'ahri'; draft.ally[0] = 'not-a-hero'; draft.bans.ally[0] = 'lulu';
  const packed = text(skill.prepare('分析', { draft }));
  assert.match(packed, /游戏：英雄联盟\n/); assert.match(packed, /蓝选：中单=阿狸/); assert.match(packed, /红选：辅助=阿狸/);
  assert.ok(!packed.includes('not-a-hero')); assert.ok(!packed.includes('露露')); assert.ok(!packed.includes('蓝禁：'));
});

test('three-ban rules omit saved fourth and fifth bans and keep the automatic next action', () => {
  const { skill, ops } = setup(); let draft = ops.setBPMode(ops.empty(), true);
  draft = ops.assignBan(draft, 'ahri', { side: 'ally', index: 4, kind: 'ban' });
  draft = ops.assignBan(draft, 'lulu', { side: 'enemy', index: 0, kind: 'ban' });
  draft = ops.setRule(draft, 'three-enemy');
  const packed = text(skill.prepare('下一手？', { draft }));
  assert.ok(!packed.includes('阿狸')); assert.match(packed, /红禁：露露/); assert.match(packed, /下一位：蓝禁1/);
  assert.match(packed, /3 禁后 5 选 · 红方先选/); assert.equal(draft.bans.ally[4], 'ahri');
});

test('profile has no direct Skill input path; migrated personal memories are optional user-level context', () => {
  const { skill, ops, context } = setup();
  const profile = {
    rank: '  Diamond  ', role: 'support', level: '意识  较强', preferences: '  不要复杂连招\n先给结论 ',
    championPool: ['lulu', '露露', 'LULU', 'karma', ''], apiKey: 'never-send-this-key', path: 'private-user-folder',
  };
  const ignored = text(skill.prepare('选谁？', { draft: ops.empty(), profile }));
  assert.ok(!ignored.includes('Diamond')); assert.ok(!ignored.includes('常用位置：辅助'));
  const memory = context.window.GameCoachMemory.normalize(undefined, profile);
  const result = skill.prepare('结合我的英雄池和段位选谁？', { draft: ops.empty(), memory, privateMarker: 'never-send-arbitrary-fields' });
  const packed = text(result);
  assert.match(packed, /段位：Diamond/); assert.match(packed, /自评水平：意识\s+较强/);
  assert.match(packed, /常用位置：辅助/); assert.match(packed, /熟悉的英雄：/);
  assert.ok(!packed.includes('never-send')); assert.ok(!packed.includes('private-user-folder'));
  assert.ok(!result.filter(message => message.role === 'system').some(message => message.content.includes('Diamond')));
});

test('identical draft snapshots are expanded once and input strings are never rewritten', () => {
  const { skill, ops } = setup(); const draft = ops.empty(); draft.ally[0] = 'lulu';
  const messages = Array.from({ length: 8 }, (_, index) => [
    { role: 'user', content: '问题' + index, draft: structuredClone(draft) }, { role: 'assistant', content: '回答' + index },
  ]).flat(); messages.push({ role: 'user', content: '  原话不改\n继续？  ' });
  const original = plain(messages); const result = skill.prepare(messages, { draft });
  assert.equal(result.filter(message => typeof message.content === 'string' && message.content.includes('蓝选：')).length, 1);
  assert.equal(result.at(-1).content, messages.at(-1).content); assert.deepEqual(plain(messages), original);
  assert.equal(result.filter(message => message.role === 'assistant').length, 8);
  assert.ok(!result.some(message => 'draft' in message));
});

test('changing games and returning to an old draft retains distinct historical references without duplicate facts', () => {
  const { skill, ops } = setup(); const pc = ops.empty('lol'); pc.ally[0] = 'anivia';
  const mobile = ops.empty('lolm'); mobile.ally[2] = 'norra';
  const messages = [{ role: 'user', content: '端游阵容', draft: pc }, { role: 'assistant', content: 'old answer' },
    { role: 'user', content: '换成手游', draft: mobile }, { role: 'assistant', content: 'mobile answer' }, { role: 'user', content: '比较一下刚才两套' }];
  const result = skill.prepare(messages, { draft: pc }); const packed = text(result);
  assert.match(packed, /【当前阵容】\n游戏：英雄联盟\n蓝选：上单=艾尼维亚/);
  assert.match(packed, /【历史1阵容】\n游戏：英雄联盟手游/); assert.match(packed, /中单=诺拉/);
  assert.equal(packed.split('艾尼维亚').length - 1, 1); assert.equal(packed.split('诺拉').length - 1, 1);
  assert.deepEqual(plain(result.filter(message => /^【本条阵容/.test(message.content)).map(message => message.content)),
    ['【本条阵容：当前】', '【本条阵容：历史1】', '【本条阵容：当前】']);
});

test('legacy messages without snapshots are marked unknown instead of receiving the current draft retroactively', () => {
  const { skill, ops } = setup(); const draft = ops.empty(); draft.ally[0] = 'garen';
  const result = skill.prepare([{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '旧回答' }, { role: 'user', content: '现在呢？' }], { draft });
  assert.ok(result.some(message => message.content === '【本条阵容未记录】'));
  assert.equal(result.at(-2).content, '【本条阵容：当前】');
});

test('generic and multimodal user content remains intact and no game is invented without context', () => {
  const { skill } = setup(); const input = [{ role: 'system', content: 'caller instruction' }, { role: 'user', content: [
    { type: 'text', text: '  看这张图片  ' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,test' } },
  ] }]; const result = skill.prepare(input);
  assert.deepEqual(plain(result.at(-1)), input.at(-1)); assert.equal(result[1].content, input[0].content);
  assert.ok(!text(result).includes('游戏：')); assert.notStrictEqual(result.at(-1).content, input.at(-1).content);
  assert.throws(() => skill.prepare(''), /请输入/); assert.throws(() => skill.prepare([{ role: 'assistant', content: 'answer' }]), /末尾/);
  assert.throws(() => skill.prepare('hi', { draft: { gameId: 'not-installed' } }), /暂未接入/);
});

test('Skill snapshots inputs before awaiting the provider and propagates cancellation', async () => {
  const { skill, core, ops } = setup(); let seen; let emit; const chunks = [];
  core.registerProvider('capture', { generate(request) { seen = request; emit = request.onDelta; return new Promise(() => {}); } });
  core.configure({ provider: 'capture' }); const draft = ops.empty(); draft.ally[0] = 'ahri';
  const input = [{ role: 'user', content: 'original' }]; const controller = new AbortController();
  const pending = skill.run(input, { context: { draft }, signal: controller.signal, onDelta: chunk => chunks.push(chunk) });
  input[0].content = 'changed'; draft.ally[0] = 'lulu'; await Promise.resolve();
  assert.equal(seen.input.at(-1).content, 'original'); assert.match(text(seen.input), /阿狸/); assert.ok(!text(seen.input).includes('露露'));
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); emit('late'); assert.equal(chunks.length, 0);
});

test('output hook preserves the exact response object and streams immediately without rewriting', () => {
  const { context } = setup(); const chunks = []; const output = context.window.GameCoachSkillOutput.create(chunk => chunks.push(chunk));
  const response = { content: '**原文**\n\n你好', timings: { totalMs: 1 }, model: 'model', finishReason: 'length' };
  output.stream('**原'); output.stream('文**'); assert.deepEqual(chunks, ['**原', '文**']);
  assert.strictEqual(output.finish(response), response);
});

test('Gemini receives game, roster and player context in its actual request shape, with execution mode kept separate', async () => {
  const calls = []; const { context, skill, ops } = setup({ fetch: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ candidates: [{ index: 0,
      content: { parts: [{ text: '**收到阵容**' }] }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  vm.runInContext(fs.readFileSync(path.join(root, 'ai-core/gemini.js'), 'utf8'), context);
  context.window.GameCoachGemini.activate('test-key-not-a-real-api-key');
  const draft = ops.empty('lolm'); draft.ally[1] = 'lulu'; draft.enemy[2] = 'akali'; const chunks = [];
  const response = await skill.run('怎么配合？', { context: { draft, profile: { role: 'support', rank: 'Diamond' } }, mode: 'quick', onDelta: chunk => chunks.push(chunk) });
  const body = JSON.parse(calls[0].options.body); const contents = JSON.stringify(body.contents);
  assert.match(contents, /英雄联盟手游/); assert.match(contents, /打野=露露/); assert.match(contents, /中单=阿卡丽/); assert.ok(!contents.includes('Diamond'));
  assert.match(body.systemInstruction.parts.map(part => part.text).join(''), /GameCoach/);
  assert.equal(body.contents.at(-1).parts.at(-1).text, '怎么配合？'); assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'MINIMAL');
  assert.equal(calls.length, 1); assert.equal(response.content, '**收到阵容**'); assert.equal(chunks.join(''), response.content);
  assert.ok(!contents.includes('test-key-not-a-real-api-key')); assert.ok(!contents.includes('champion-icons'));
});
