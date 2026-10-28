const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');

for (const [mode, moduleName, other, model] of [
  ['quick', 'GameCoachSkillQuick', 'GameCoachSkillCoach', 'demo-instant'],
  ['coach', 'GameCoachSkillCoach', 'GameCoachSkillQuick', 'demo-reasoning'],
]) {
  test(mode + ' works without the other mode file or index.js', async () => {
    const ctx = {window: {}, structuredClone, setTimeout, clearTimeout, AbortController, DOMException, performance};
    vm.createContext(ctx);
    for (const file of ['ai-core/demo.js', 'ai-core/index.js', 'skill/shared.js', 'skill/' + mode + '.js']) {
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {filename: file});
    }
    ctx.window.GameCoachMemoryRetrieval = {select: () => ({text: '', entries: []})};
    const requests = [];
    ctx.window.GameCoachAI.registerProvider('capture', {async generate(request) {
      requests.push(request); return {content: 'answer'};
    }});
    ctx.window.GameCoachAI.configure({provider: 'capture'});
    const conversation = {id: 'same-chat', userId: 'same-user'};
    const messages = [{role: 'user', content: 'first'}, {role: 'assistant', content: 'earlier answer'},
      {role: 'user', content: 'follow-up'}];
    const before = JSON.stringify(messages);
    const response = await ctx.window[moduleName].run(messages, {
      conversation, mode: mode === 'quick' ? 'coach' : 'quick',
    });
    assert.equal(ctx.window[other], undefined);
    assert.equal(ctx.window.GameCoachSkill, undefined);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, model);
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0].conversation)), conversation);
    assert.ok(requests[0].input.some(message => message.content === 'earlier answer'));
    assert.equal(response.mode, mode);
    assert.equal(response.content, 'answer');
    assert.equal(JSON.stringify(messages), before);
  });
}
