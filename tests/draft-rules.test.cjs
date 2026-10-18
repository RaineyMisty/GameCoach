const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function setup() { const context = { window: {} }; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'frontend/draft.js'), 'utf8'), context); return context.window.GameCoachDraft; }

for (const type of ['five', 'split', 'three']) for (const first of ['ally', 'enemy']) {
  test(`${type}, ${first} first: exact schedule fills all slots and resumes the earliest deleted step`, () => {
    const ops = setup(); let draft = ops.setBPMode(ops.setRule(ops.empty(), type + '-' + first), true);
    const second = first === 'ally' ? 'enemy' : 'ally'; const symbol = side => side === first ? 'A' : 'B';
    const plan = ops.sequence(draft); const visited = [];
    assert.equal(plan.length, type === 'three' ? 16 : 20);
    assert.equal(plan.map(step => symbol(step.slot.side)).join(''), type === 'split' ? 'ABABABABBAABBABABAAB' : 'AB'.repeat(type === 'three' ? 3 : 5) + 'ABBAABBAAB');
    assert.equal(plan.filter(step => step.slot.kind === 'ban').length, type === 'three' ? 6 : 10);
    assert.equal(plan.filter(step => step.slot.side === first && step.slot.kind !== 'ban').length, 5);
    assert.equal(plan.filter(step => step.slot.side === second && step.slot.kind !== 'ban').length, 5);
    for (let i = 0; i < plan.length; i++) {
      const next = ops.nextAction(draft); assert.deepEqual(plain(next), plain(plan[i]));
      const hero = 'hero-' + i; const slot = next.slot;
      draft = slot.kind === 'ban' ? ops.assignBan(draft, hero, slot) : ops.assign(draft, hero, slot);
      visited.push(hero);
    }
    assert.equal(ops.nextAction(draft), null); assert.equal(ops.count(draft), 10);
    assert.equal(ops.count(draft, undefined, 'ban'), type === 'three' ? 6 : 10);
    const removed = ops.remove(draft, plan[2].slot);
    assert.deepEqual(plain(ops.nextAction(removed)), plain(plan[2]));
    assert.equal(ops.count(removed), 10);
    assert.equal(draft.bans[first][1], visited[2]);
  });
}

test('split draft phase boundaries and the second ban and pick phases start with the second team', () => {
  const ops = setup(); const plan = ops.sequence(ops.setRule(ops.empty(), 'split-ally'));
  assert.deepEqual(plain(plan.map(step => step.phase)), [
    ...Array(6).fill('第一轮禁用'), ...Array(6).fill('第一轮选人'), ...Array(4).fill('第二轮禁用'), ...Array(4).fill('第二轮选人'),
  ]);
  assert.deepEqual(plain(plan[12].slot), { side: 'enemy', index: 3, kind: 'ban' });
  assert.deepEqual(plain(plan[16].slot), { side: 'enemy', index: 3 });
  assert.deepEqual(plain(plan[19].slot), { side: 'enemy', index: 4 });
});

test('changing presets retains all existing picks and bans, including temporarily hidden bans', () => {
  const ops = setup(); let draft = ops.setBPMode(ops.empty(), true);
  draft = ops.assignBan(draft, 'ahri', { side: 'ally', index: 4, kind: 'ban' });
  draft = ops.assignBan(draft, 'garen', { side: 'enemy', index: 0, kind: 'ban' });
  draft = ops.assign(draft, 'lulu', { side: 'enemy', index: 3 });
  const three = ops.setRule(draft, 'three-enemy');
  assert.equal(ops.banLimit(three), 3); assert.equal(three.bans.ally[4], 'ahri'); assert.equal(three.enemy[3], 'lulu');
  assert.equal(ops.activeBan(three, 'ahri'), false); assert.equal(ops.activeBan(three, 'garen'), true);
  const restored = ops.setRule(three, 'five-ally'); assert.deepEqual(plain(restored), plain(draft));
  assert.throws(() => ops.assignBan(three, 'new', { side: 'ally', index: 4, kind: 'ban' }), /没有这个禁用位/);
  const picked = ops.assign(three, 'ahri', { side: 'ally', index: 0 });
  assert.equal(picked.ally[0], 'ahri'); assert.equal(picked.bans.ally[4], null);
});

test('prefilled pick slots are skipped at their scheduled steps without reshuffling existing heroes', () => {
  const ops = setup(); let draft = ops.setBPMode(ops.setRule(ops.normalize({ ally: ['ahri', 'garen'], enemy: ['lulu'] }), 'split-enemy'), true);
  for (let i = 0; i < 6; i++) { const next = ops.nextAction(draft); draft = ops.assignBan(draft, 'ban-' + i, next.slot); }
  const next = ops.nextAction(draft);
  assert.equal(next.phase, '第一轮选人'); assert.equal(next.step, 10);
  assert.deepEqual(plain(next.slot), { side: 'enemy', index: 1 });
  assert.deepEqual(plain(draft.ally), ['ahri', 'garen', null, null, null]); assert.equal(draft.enemy[0], 'lulu');
});

test('rule selection persists through mode toggles, reset, storage export/import and reload', () => {
  const saved = new Map(); const context = { window: {}, crypto: require('node:crypto').webcrypto, structuredClone,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } };
  vm.createContext(context); const files = ['frontend/data.js', 'frontend/draft.js', 'frontend/storage.js'];
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  const ops = context.window.GameCoachDraft; const store = context.window.GCStore;
  let draft = ops.setBPMode(ops.setRule(ops.empty(), 'three-enemy'), true);
  draft = ops.assignBan(draft, 'ahri', { side: 'enemy', index: 1, kind: 'ban' });
  assert.equal(ops.clear(draft).bpRule, 'three-enemy'); assert.equal(ops.clear(draft).bpMode, true);
  store.current().draft = ops.setBPMode(draft, false); store.persist();
  const backup = JSON.parse(JSON.stringify(store.exportUser())); store.importBackup(backup);
  assert.equal(store.current().draft.bpRule, 'three-enemy');
  const reloaded = { window: {}, localStorage: context.localStorage }; vm.createContext(reloaded);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), reloaded);
  const restored = reloaded.window.GameCoachDraft.setBPMode(reloaded.window.GCStore.current().draft, true);
  assert.equal(restored.bpRule, 'three-enemy'); assert.equal(restored.bans.enemy[1], 'ahri');
  assert.equal(ops.setRule(restored, 'untrusted').bpRule, 'five-ally');
});
