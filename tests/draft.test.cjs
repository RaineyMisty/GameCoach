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
  vm.createContext(context); for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js', 'frontend/draft.js', 'frontend/storage.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  const store = context.window.GCStore; store.current().draft = context.window.GameCoachDraft.normalize({ ally: [null, 'lulu', null, null, 'jinx'], enemy: [null, 'lulu', 'ahri', null, null] }); store.persist();
  const backup = JSON.parse(JSON.stringify(store.exportUser())); store.importBackup(backup);
  assert.deepEqual(plain(store.current().draft), backup.user.draft); assert.equal(store.current().draft.ally[1], 'lulu');
  const reloaded = { window: {}, localStorage: context.localStorage }; vm.createContext(reloaded);
  for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js', 'frontend/draft.js', 'frontend/storage.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), reloaded);
  assert.deepEqual(plain(reloaded.window.GCStore.current().draft), backup.user.draft);
});
test('official rosters have searchable names, supported roles and local square portraits from Riot', () => {
  const context = { window: {} }; vm.createContext(context); for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  const roster = context.window.GAMECOACH_DATA.champions; assert.ok(roster.length >= 142); assert.equal(new Set(roster.map(hero => hero.id)).size, roster.length);
  const manifests = Object.fromEntries(['lol', 'lolm'].map(id => [id, JSON.parse(fs.readFileSync(path.join(root, 'resources', id, 'champion-icons/sources.json'), 'utf8'))]));
  for (const game of context.window.GameCoachGames.list) for (const hero of game.champions) {
    assert.ok(hero.name && hero.englishName && hero.title);
    assert.ok(hero.roles.length && hero.roles.every(role => ['top', 'jungle', 'mid', 'adc', 'support'].includes(role)));
    const folder = hero.portrait.startsWith('../resources/lolm/') ? 'lolm' : 'lol';
    const source = manifests[folder].images.find(image => image.id === hero.id);
    assert.ok(source, `Missing source record for ${hero.id}`);
    assert.equal(new URL(source.source).hostname, folder === 'lolm' ? 'game.gtimg.cn' : 'ddragon.leagueoflegends.com');
    assert.equal(source.status, 'downloaded'); assert.equal(source.source, hero.sourcePortrait);
    const bytes = fs.readFileSync(path.join(root, 'frontend', hero.portrait));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    assert.equal(width, height); assert.ok([120, 128].includes(width));
    assert.equal(width, source.width); assert.equal(height, source.height);
  }
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
  const swapped = ops.move(bp, { side: 'ally', index: 0 }, { side: 'enemy', index: 0, kind: 'ban' });
  assert.equal(swapped.ally[0], 'lulu'); assert.equal(swapped.bans.enemy[0], 'ahri');
  assert.equal(bp.ally[0], 'ahri'); assert.equal(bp.bans.enemy[0], 'lulu');
  const mirrorAttempt = ops.assign(bp, 'ahri', { side: 'enemy', index: 2 });
  assert.equal(ops.count(mirrorAttempt), 1); assert.equal(mirrorAttempt.ally[0], null); assert.equal(mirrorAttempt.enemy[2], 'ahri');
});

test('dragging between occupied ban and pick slots swaps both heroes and keeps every other position', () => {
  const ops = setup(); let bp = ops.setBPMode(ops.empty('lol'), true);
  bp = ops.assign(bp, 'ahri', { side: 'ally', index: 0 });
  bp = ops.assign(bp, 'garen', { side: 'enemy', index: 4 });
  bp = ops.assignBan(bp, 'lulu', { side: 'ally', index: 1, kind: 'ban' });
  bp = ops.assignBan(bp, 'jinx', { side: 'enemy', index: 2, kind: 'ban' });
  for (const side of ['ally', 'enemy']) {
    const pick = { side: 'ally', index: 0 }; const ban = { side, index: side === 'ally' ? 1 : 2, kind: 'ban' };
    const banned = bp.bans[side][ban.index];
    for (const [from, to] of [[pick, ban], [ban, pick]]) {
      const swapped = ops.move(bp, from, to);
      const expected = plain(bp); expected.ally[0] = banned; expected.bans[side][ban.index] = 'ahri';
      assert.deepEqual(plain(swapped), expected);
      assert.deepEqual(plain(ops.move(swapped, to, from)), plain(bp));
      assert.equal(ops.count(swapped), 2); assert.equal(ops.count(swapped, undefined, 'ban'), 2);
    }
  }
});

test('ban-pick moves into empty slots change status without dropping heroes and resume the earliest hole', () => {
  const ops = setup(); let bp = ops.setBPMode(ops.setRule(ops.empty(), 'three-ally'), true);
  bp = ops.assign(bp, 'ahri', { side: 'enemy', index: 4 });
  bp = ops.assignBan(bp, 'lulu', { side: 'ally', index: 0, kind: 'ban' });
  const picked = ops.move(bp, { side: 'ally', index: 0, kind: 'ban' }, { side: 'ally', index: 4 });
  assert.equal(picked.ally[4], 'lulu'); assert.equal(picked.bans.ally[0], null); assert.equal(picked.enemy[4], 'ahri');
  assert.deepEqual(plain(ops.nextAction(picked).slot), { side: 'ally', index: 0, kind: 'ban' });
  const banned = ops.move(bp, { side: 'enemy', index: 4 }, { side: 'enemy', index: 2, kind: 'ban' });
  assert.equal(banned.enemy[4], null); assert.equal(banned.bans.enemy[2], 'ahri'); assert.equal(banned.bans.ally[0], 'lulu');
  assert.equal(ops.count(banned) + ops.count(banned, undefined, 'ban'), 2);
  assert.equal(bp.enemy[4], 'ahri'); assert.equal(bp.bans.enemy[2], null);
});

test('cross-group moves require BP mode and reject only out-of-range ban slots without changing the draft', () => {
  const ops = setup(); let bp = ops.setBPMode(ops.empty(), true);
  bp = ops.assign(bp, 'ahri', { side: 'ally', index: 4 });
  bp = ops.assignBan(bp, 'lulu', { side: 'enemy', index: 4, kind: 'ban' });
  const three = ops.setRule(bp, 'three-enemy'); const original = plain(three);
  assert.throws(() => ops.move(three, { side: 'enemy', index: 4, kind: 'ban' }, { side: 'ally', index: 0 }), /没有这个禁用位/);
  assert.throws(() => ops.move(three, { side: 'ally', index: 4 }, { side: 'enemy', index: 4, kind: 'ban' }), /没有这个禁用位/);
  assert.deepEqual(plain(three), original);
  const normal = ops.setBPMode(bp, false);
  assert.throws(() => ops.move(normal, { side: 'ally', index: 4 }, { side: 'enemy', index: 0, kind: 'ban' }), /开启 BP/);
  assert.throws(() => ops.move(normal, { side: 'enemy', index: 4, kind: 'ban' }, { side: 'ally', index: 0 }), /开启 BP/);
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
  vm.createContext(context); const files = ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js', 'frontend/draft.js', 'frontend/storage.js'];
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
