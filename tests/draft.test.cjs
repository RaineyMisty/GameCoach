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
  const moved = ops.move(draft, { side: 'ally', index: 1 }, { side: 'enemy', index: 2 });
  assert.equal(moved.enemy[2], 'b'); assert.equal(moved.ally[1], 'c'); assert.equal(ops.count(moved), 3); assert.deepEqual(plain(draft.ally), ['a', 'b', null, null, null]);
});
test('explicit replacement releases the previous pick and does not shift adjacent roles', () => {
  const ops = setup(); const draft = { ally: ['a', 'b', 'c'], enemy: [] };
  const next = ops.assign(draft, 'new', { side: 'ally', index: 1 }); assert.deepEqual(plain(next.ally), ['a', 'new', 'c', null, null]); assert.equal(ops.locate(next, 'b'), null);
});
test('normalization preserves empty slots and removes unknown or duplicate heroes without collapsing positions', () => {
  const ops = setup(); const draft = ops.normalize({ ally: ['a', null, 'bad', 'b', 'a', 'extra'], enemy: ['b', 'c'] }, id => ['a', 'b', 'c'].includes(id));
  assert.deepEqual(plain(draft), { ...plain(ops.empty()), ally: ['a', null, null, 'b', null], enemy: ['b', 'c', null, null, null] });
  assert.throws(() => ops.move(draft, { side: 'ally', index: 9 }, { side: 'enemy', index: 0 }));
});
test('role slots round trip through local storage and exported user backups', () => {
  const saved = new Map(); const context = { window: {}, crypto: require('node:crypto').webcrypto, structuredClone,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } };
  vm.createContext(context); for (const file of ['frontend/data.js', 'frontend/draft.js', 'frontend/storage.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  const store = context.window.GCStore; store.current().draft = context.window.GameCoachDraft.normalize({ ally: [null, 'lulu', null, null, 'jinx'], enemy: [null, 'lulu', 'ahri', null, null] }); store.persist();
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

test('mirror picks are allowed across teams while assignment remains unique within each team', () => {
  const ops = setup(); let draft = ops.assign(ops.empty(), 'ahri', { side: 'ally', index: 0 });
  draft = ops.assign(draft, 'ahri', { side: 'enemy', index: 0 });
  assert.equal(ops.count(draft), 2); assert.equal(draft.ally[0], 'ahri'); assert.equal(draft.enemy[0], 'ahri');
  draft = ops.assign(draft, 'ahri', { side: 'enemy', index: 3 });
  assert.deepEqual(plain(draft.enemy), [null, null, null, 'ahri', null]); assert.equal(draft.ally[0], 'ahri');
  const removed = ops.remove(draft, { side: 'enemy', index: 3 });
  assert.equal(removed.ally[0], 'ahri'); assert.equal(removed.enemy[3], null);
});
test('dragging mirrored picks uses the exact source slot and refuses duplicate-producing swaps', () => {
  const ops = setup(); const draft = { ally: ['ahri', 'garen', null, null, null], enemy: ['ahri', 'lulu', null, null, null] };
  const moved = ops.move(draft, { side: 'enemy', index: 0 }, { side: 'enemy', index: 2 });
  assert.equal(moved.ally[0], 'ahri'); assert.deepEqual(plain(moved.enemy), [null, 'lulu', 'ahri', null, null]);
  assert.throws(() => ops.move(draft, { side: 'ally', index: 0 }, { side: 'enemy', index: 1 }), /重复英雄/);
  assert.throws(() => ops.move(draft, { side: 'ally', index: 0 }, { side: 'enemy', index: 2 }), /重复英雄/);
  const reverseCollision = { ally: ['ahri', 'lulu', null, null, null], enemy: ['lulu', null, null, null, null] };
  assert.throws(() => ops.move(reverseCollision, { side: 'ally', index: 0 }, { side: 'enemy', index: 0 }), /重复英雄/);
  const same = ops.move(draft, { side: 'ally', index: 0 }, { side: 'enemy', index: 0 });
  assert.deepEqual(plain(same), { ...plain(ops.empty()), ...draft }); assert.equal(draft.ally[0], 'ahri');
});

test('entering BP preserves blue picks and removes only red mirrors without shifting slots', () => {
  const ops = setup(); const original = ops.normalize({ ally: ['ahri', 'garen'], enemy: ['lulu', 'ahri', null, 'garen', 'jinx'] });
  const bp = ops.setBPMode(original, true);
  assert.equal(bp.bpMode, true); assert.deepEqual(plain(bp.ally), plain(original.ally));
  assert.deepEqual(plain(bp.enemy), ['lulu', null, null, null, 'jinx']);
  assert.equal(original.enemy[1], 'ahri'); assert.equal(original.bpMode, false);
  assert.deepEqual(plain(ops.setBPMode(ops.setBPMode(bp, false), true)), plain(bp));
});

test('saved bans survive toggling and ordinary selection retires only the selected hero ban', () => {
  const ops = setup(); let bp = ops.setBPMode(ops.empty(), true);
  bp = ops.assignBan(bp, 'ahri', { side: 'ally', index: 2, kind: 'ban' });
  bp = ops.assignBan(bp, 'garen', { side: 'enemy', index: 4, kind: 'ban' });
  const normal = ops.setBPMode(bp, false); assert.equal(normal.bans.ally[2], 'ahri');
  assert.deepEqual(plain(ops.setBPMode(normal, true)), plain(bp));
  const picked = ops.assign(normal, 'ahri', { side: 'ally', index: 0 });
  assert.equal(picked.bans.ally[2], null); assert.equal(picked.bans.enemy[4], 'garen');
  const reopened = ops.setBPMode(picked, true); assert.equal(reopened.ally[0], 'ahri'); assert.equal(reopened.bans.enemy[4], 'garen');
});

test('BP disallows banned picks and picked bans and can reorder each group without duplicates', () => {
  const ops = setup(); let bp = ops.setBPMode(ops.empty(), true);
  bp = ops.assign(bp, 'ahri', { side: 'ally', index: 0 });
  bp = ops.assignBan(bp, 'lulu', { side: 'enemy', index: 0, kind: 'ban' });
  assert.throws(() => ops.assign(bp, 'lulu', { side: 'enemy', index: 1 }), /禁用/);
  assert.throws(() => ops.assignBan(bp, 'ahri', { side: 'ally', index: 1, kind: 'ban' }), /已选/);
  const moved = ops.move(bp, { side: 'enemy', index: 0, kind: 'ban' }, { side: 'ally', index: 3, kind: 'ban' });
  assert.equal(moved.bans.enemy[0], null); assert.equal(moved.bans.ally[3], 'lulu'); assert.equal(moved.ally[0], 'ahri');
  assert.throws(() => ops.move(bp, { side: 'ally', index: 0 }, { side: 'enemy', index: 0, kind: 'ban' }), /不能直接交换/);
  const mirrorAttempt = ops.assign(bp, 'ahri', { side: 'enemy', index: 2 });
  assert.equal(ops.count(mirrorAttempt), 1); assert.equal(mirrorAttempt.ally[0], null); assert.equal(mirrorAttempt.enemy[2], 'ahri');
});

test('ban removal affects only its slot and reset keeps BP enabled while clearing all units', () => {
  const ops = setup(); let bp = ops.setBPMode(ops.empty(), true);
  bp = ops.assignBan(bp, 'ahri', { side: 'ally', index: 0, kind: 'ban' });
  bp = ops.assignBan(bp, 'lulu', { side: 'enemy', index: 1, kind: 'ban' });
  bp = ops.assign(bp, 'garen', { side: 'enemy', index: 2 });
  const removed = ops.remove(bp, { side: 'ally', index: 0, kind: 'ban' });
  assert.equal(removed.bans.ally[0], null); assert.equal(removed.bans.enemy[1], 'lulu'); assert.equal(removed.enemy[2], 'garen');
  const cleared = ops.clear(bp); assert.equal(cleared.bpMode, true); assert.equal(ops.count(cleared), 0); assert.equal(ops.count(cleared, undefined, 'ban'), 0);
});

test('normalization accepts legacy drafts and sanitizes mode, picks and hidden bans together', () => {
  const ops = setup(); const legacy = ops.normalize({ ally: ['ahri'], enemy: ['ahri'] });
  assert.equal(legacy.bpMode, false); assert.equal(ops.count(legacy), 2); assert.equal(ops.count(legacy, undefined, 'ban'), 0);
  const value = { ...legacy, bpMode: true, bans: { ally: ['ahri', null, 'garen', 'garen'], enemy: ['garen', 'lulu', 'bad'] } };
  const cleaned = ops.normalize(value, id => ['ahri', 'garen', 'lulu'].includes(id));
  assert.equal(cleaned.enemy[0], null); assert.deepEqual(plain(cleaned.bans), { ally: [null, null, 'garen', null, null], enemy: [null, 'lulu', null, null, null] });
});

test('BP mode and hidden bans persist through storage, export, import and reload', () => {
  const saved = new Map(); const context = { window: {}, crypto: require('node:crypto').webcrypto, structuredClone,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } };
  vm.createContext(context); const files = ['frontend/data.js', 'frontend/draft.js', 'frontend/storage.js'];
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  const ops = context.window.GameCoachDraft; const store = context.window.GCStore;
  let draft = ops.setBPMode(ops.empty(), true);
  draft = ops.assignBan(draft, 'ahri', { side: 'ally', index: 0, kind: 'ban' });
  draft = ops.assign(draft, 'garen', { side: 'enemy', index: 2 });
  store.current().draft = ops.setBPMode(draft, false); store.persist();
  const backup = JSON.parse(JSON.stringify(store.exportUser())); store.importBackup(backup);
  assert.equal(store.current().draft.bans.ally[0], 'ahri'); assert.equal(store.current().draft.bpMode, false);
  store.current().draft = ops.setBPMode(store.current().draft, true); store.persist();
  const reloaded = { window: {}, localStorage: context.localStorage }; vm.createContext(reloaded);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), reloaded);
  assert.equal(reloaded.window.GCStore.current().draft.bpMode, true);
  assert.equal(reloaded.window.GCStore.current().draft.bans.ally[0], 'ahri'); assert.equal(reloaded.window.GCStore.current().draft.enemy[2], 'garen');
});
