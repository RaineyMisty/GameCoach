const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');

test('demo runs without game data, memory, storage or real Skill preparation', async () => {
  const ctx = {window: {}, structuredClone, setTimeout, clearTimeout, AbortController, DOMException, performance};
  vm.createContext(ctx);
  for (const file of ['ai-core/demo.js', 'ai-core/index.js', 'skill/index.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {filename: file});
  }
  ctx.window.GameCoachSkillInput = {build() {throw Error('Demo entered real Skill');}};
  const chunks = [];
  const context = {get draft() {throw Error('Demo read game context');}};
  const result = await ctx.window.GameCoachSkill.run('hello', {context, onDelta: text => chunks.push(text)});
  assert.equal(result.isDemo, true);
  assert.equal(result.provider, 'demo');
  assert.equal(chunks.join(''), result.content);
  assert.match(result.content, /hello/);
  assert.equal(result.sources.length, 0);
  assert.equal(result.usedMemories.length, 0);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(ctx.window.GameCoachSkill.run('hello', {signal: abort.signal}), {name: 'AbortError'});
  let prepared = 0, called = 0;
  ctx.window.GameCoachSkillInput = {build(input) {
    prepared++;
    return {messages: [{role: 'user', content: input}], sources: [], usedMemories: []};
  }};
  ctx.window.GameCoachSkillKnowledge = {wantsSearch: () => false};
  ctx.window.GameCoachAI.registerProvider('capture', {generate: async () => {called++; return {content: 'real path'};}});
  ctx.window.GameCoachAI.configure({provider: 'capture'});
  const answer = await ctx.window.GameCoachSkill.run('hello');
  assert.equal(prepared, 1); assert.equal(called, 1);
  assert.equal(answer.isDemo, false); assert.equal(answer.content, 'real path');
});

test('page loads the independent demo before core and loads one consolidated Skill', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
  for (const source of scripts) assert.ok(fs.existsSync(path.resolve(root, 'frontend', source)), source);
  assert.ok(scripts.indexOf('../ai-core/demo.js') < scripts.indexOf('../ai-core/index.js'));
  assert.deepEqual(scripts.filter(source => source.startsWith('../skill/')), ['../skill/index.js']);
});
