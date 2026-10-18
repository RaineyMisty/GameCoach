const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function setup() { const context = { window: {} }; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'frontend/draft.js'), 'utf8'), context); return context.window.GameCoachDraft; }
const plain = value => JSON.parse(JSON.stringify(value));
test('ten clicks alternate sides and positions without requiring team switching', () => {
  const ops = setup(); let draft = ops.empty(); let target = ops.nextEmpty(draft); const sequence = [];
  for (let n = 0; n < 10; n++) { sequence.push(target.side + ':' + target.index); draft = ops.assign(draft, 'hero-' + n, target); target = ops.nextEmpty(draft, target); }
  assert.deepEqual(sequence, ['ally:0', 'enemy:0', 'ally:1', 'enemy:1', 'ally:2', 'enemy:2', 'ally:3', 'enemy:3', 'ally:4', 'enemy:4']);
  assert.equal(target, null); assert.equal(ops.count(draft), 10); assert.equal(ops.count(draft, 'ally'), 5);
});
test('removing a champion preserves the roles of every remaining hero and refills holes', () => {
  const ops = setup(); const draft = { ally: ['a', 'b', 'c', 'd', 'e'], enemy: ['f', 'g', 'h', 'i', 'j'] };
  const next = ops.remove(draft, { side: 'ally', index: 1 }); assert.deepEqual(plain(next.ally), ['a', null, 'c', 'd', 'e']);
  assert.deepEqual(plain(ops.nextEmpty(next)), { side: 'ally', index: 1 }); assert.equal(draft.ally[1], 'b');
});
test('moving from own jungle to empty enemy mid preserves hero identity and source hole', () => {
  const ops = setup(); let draft = ops.assign(ops.empty(), 'lulu', { side: 'ally', index: 1 });
  const moved = ops.move(draft, { side: 'ally', index: 1 }, { side: 'enemy', index: 2 });
  assert.equal(moved.ally[1], null); assert.equal(moved.enemy[2], 'lulu'); assert.equal(ops.count(moved), 1); assert.equal(draft.ally[1], 'lulu');
});
test('dragging to an occupied position swaps instead of overwriting or duplicating', () => {
  const ops = setup(); const draft = { ally: ['a', 'b', null, null, null], enemy: [null, null, 'c', null, null] };
  const moved = ops.assign(draft, 'b', { side: 'enemy', index: 2 });
  assert.equal(moved.enemy[2], 'b'); assert.equal(moved.ally[1], 'c'); assert.equal(ops.count(moved), 3); assert.deepEqual(plain(draft.ally), ['a', 'b', null, null, null]);
});
test('explicit replacement releases the previous pick and does not shift adjacent roles', () => {
  const ops = setup(); const draft = { ally: ['a', 'b', 'c'], enemy: [] };
  const next = ops.assign(draft, 'new', { side: 'ally', index: 1 }); assert.deepEqual(plain(next.ally), ['a', 'new', 'c', null, null]); assert.equal(ops.locate(next, 'b'), null);
});
test('normalization preserves empty slots and removes unknown or duplicate heroes without collapsing positions', () => {
  const ops = setup(); const draft = ops.normalize({ ally: ['a', null, 'bad', 'b', 'a', 'extra'], enemy: ['b', 'c'] }, id => ['a', 'b', 'c'].includes(id));
  assert.deepEqual(plain(draft), { ally: ['a', null, null, 'b', null], enemy: [null, 'c', null, null, null] });
  assert.throws(() => ops.move(draft, { side: 'ally', index: 9 }, { side: 'enemy', index: 0 }));
});
test('role slots round trip through local storage and exported user backups', () => {
  const saved = new Map(); const context = { window: {}, crypto: require('node:crypto').webcrypto, structuredClone,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } };
  vm.createContext(context); for (const file of ['frontend/data.js', 'frontend/draft.js', 'frontend/storage.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  const store = context.window.GCStore; store.current().draft = { ally: [null, 'lulu', null, null, 'jinx'], enemy: [null, null, 'ahri', null, null] }; store.persist();
  const backup = JSON.parse(JSON.stringify(store.exportUser())); store.importBackup(backup);
  assert.deepEqual(plain(store.current().draft), backup.user.draft); assert.equal(store.current().draft.ally[1], 'lulu');
  const reloaded = { window: {}, localStorage: context.localStorage }; vm.createContext(reloaded);
  for (const file of ['frontend/data.js', 'frontend/draft.js', 'frontend/storage.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), reloaded);
  assert.deepEqual(plain(reloaded.window.GCStore.current().draft), backup.user.draft);
});
test('official roster has searchable names, supported role filters, unique ids and local portraits', () => {
  const context = { window: {} }; vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(root, 'frontend/data.js'), 'utf8'), context);
  const roster = context.window.GAMECOACH_DATA.champions; assert.ok(roster.length >= 142); assert.equal(new Set(roster.map(hero => hero.id)).size, roster.length);
  for (const hero of roster) { assert.ok(hero.name && hero.englishName && hero.title); assert.ok(hero.roles.length && hero.roles.every(role => ['top', 'jungle', 'mid', 'adc', 'support'].includes(role))); assert.ok(fs.statSync(path.join(root, 'frontend', hero.portrait)).size > 500); }
  for (const id of ['karma', 'lulu', 'nami', 'leona', 'jinx', 'caitlyn', 'akali', 'master-yi', 'malphite', 'pantheon', 'ahri', 'garen']) assert.ok(roster.some(hero => hero.id === id));
});
