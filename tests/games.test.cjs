const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(saved = new Map()) {
  const context = { window: {}, crypto: require('node:crypto').webcrypto, structuredClone,
    localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } };
  vm.createContext(context);
  for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js', 'frontend/data.js', 'frontend/draft.js', 'frontend/storage.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return { context, saved, games: context.window.GameCoachGames, ops: context.window.GameCoachDraft, store: context.window.GCStore };
}
test('game catalogues share common portraits and keep mobile-only portraits in the mobile directory', () => {
  const { games } = setup(); const pc = games.get('lol'); const mobile = games.get('lolm');
  assert.ok(pc.champions.length > mobile.champions.length); assert.equal(games.list.length, 2);
  assert.ok(pc.champions.some(hero => hero.id === 'anivia')); assert.ok(!mobile.champions.some(hero => hero.id === 'anivia'));
  assert.equal(pc.champions.find(hero => hero.id === 'ahri').portrait, mobile.champions.find(hero => hero.id === 'ahri').portrait);
  const pcIds = new Set(pc.champions.map(hero => hero.id));
  for (const game of games.list) for (const hero of game.champions) {
    const folder = pcIds.has(hero.id) ? 'lol' : 'lolm';
    assert.equal(hero.portrait, `../resources/${folder}/champion-icons/${hero.id}.png`); assert.ok(hero.roles.length);
    assert.ok(fs.existsSync(path.join(root, 'resources', game.gameId, 'champions.js')));
  }
});
test('game switching carries current picks, bans and settings without resurrecting filtered heroes', () => {
  const { store, ops, saved } = setup();
  let mobile = ops.setRule(ops.setBPMode(ops.empty('lolm'), true), 'three-enemy');
  mobile = ops.assign(mobile, 'ahri', { side: 'ally', index: 2 }); mobile = ops.assignBan(mobile, 'lulu', { side: 'enemy', index: 1, kind: 'ban' }); store.saveDraft(mobile);
  assert.deepEqual(plain(store.selectGame('lol')), { ...plain(mobile), gameId: 'lol' });
  let pc = ops.assign(store.current().draft, 'anivia', { side: 'enemy', index: 4 }); store.saveDraft(pc);
  assert.deepEqual(plain(store.selectGame('lolm')), plain(mobile));
  assert.deepEqual(plain(store.selectGame('lol')), { ...plain(mobile), gameId: 'lol' });
  assert.equal(pc.enemy[4], 'anivia'); assert.equal(mobile.gameId, 'lolm');
  const next = setup(saved); assert.equal(next.store.current().draft.gameId, 'lol'); assert.equal(next.store.current().draft.enemy[4], null);
  assert.deepEqual(plain(next.store.selectGame('lolm')), plain(mobile));
});
test('legacy user drafts and historical messages migrate to mobile without losing positions', () => {
  const { store, saved } = setup(); store.current().draft = { ally: [null, 'lulu'], enemy: ['ahri'], bpMode: true, bans: { ally: [null, null, 'jinx'] } };
  store.current().sessions.push({ id: 'legacy-chat', title: 'Legacy', created: '', messages: [{ role: 'user', content: 'legacy', mode: 'quick', draft: { ally: ['garen'], enemy: ['ahri'] } }] });
  store.persist(); const next = setup(saved);
  assert.equal(next.store.current().draft.gameId, 'lolm'); assert.equal(next.store.current().draft.ally[1], 'lulu'); assert.equal(next.store.current().draft.bans.ally[2], 'jinx');
  assert.equal(next.store.current().sessions[0].messages[0].draft.gameId, 'lolm');
  next.store.selectGame('lol'); assert.equal(next.ops.count(next.store.current().draft), 2); assert.equal(next.store.selectGame('lolm').ally[1], 'lulu');
  assert.equal(next.store.current().sessions[0].messages[0].draft.gameId, 'lolm');
});
test('storage validates champions against the selected game, including inactive drafts in backups', () => {
  const { store, ops } = setup();
  assert.equal(store.cleanDraft({ gameId: 'lol', ally: ['anivia'] }).ally[0], 'anivia');
  assert.equal(store.cleanDraft({ gameId: 'lolm', ally: ['anivia'] }).ally[0], null);
  store.saveDraft(ops.assign(ops.empty('lol'), 'anivia', { side: 'ally', index: 0 }));
  store.selectGame('lolm'); const backup = plain(store.exportUser()); store.importBackup(backup);
  assert.equal(store.current().draft.gameId, 'lolm'); assert.equal(store.selectGame('lol').ally[0], null);
  assert.throws(() => store.selectGame('not-installed'), /暂未接入/);
});

test('switching filters picks and hidden bans in place and ignores stale destination drafts', () => {
  const { store, ops, saved } = setup();
  const pc = ops.empty('lol'); pc.bpMode = false; pc.bpRule = 'three-enemy';
  pc.ally = ['ahri', 'anivia', null, 'garen', null]; pc.enemy = [null, 'lulu', null, null, null];
  pc.bans.ally = ['azir', null, 'jinx', null, null]; pc.bans.enemy = [null, null, null, null, 'caitlyn'];
  store.saveDraft(pc);
  store.current().drafts.lolm = ops.assign(ops.empty('lolm'), 'annie', { side: 'ally', index: 0 });
  store.current().sessions.push({ id: 'pc-chat', messages: [{ role: 'user', content: 'snapshot', draft: structuredClone(pc) }] });
  const mobile = store.selectGame('lolm');
  assert.deepEqual(plain(mobile.ally), ['ahri', null, null, 'garen', null]);
  assert.deepEqual(plain(mobile.enemy), [null, 'lulu', null, null, null]);
  assert.deepEqual(plain(mobile.bans.ally), [null, null, 'jinx', null, null]);
  assert.deepEqual(plain(mobile.bans.enemy), [null, null, null, null, 'caitlyn']);
  assert.equal(mobile.bpMode, false); assert.equal(mobile.bpRule, 'three-enemy');
  const reloaded = setup(saved).store;
  assert.deepEqual(plain(reloaded.current().draft), plain(mobile));
  assert.deepEqual(plain(reloaded.selectGame('lol')), { ...plain(mobile), gameId: 'lol' });
  assert.equal(reloaded.current().sessions[0].messages[0].draft.ally[1], 'anivia');
});
test('different local users retain their own active game and drafts', () => {
  const { store, ops } = setup(); const first = store.current().id;
  store.saveDraft(ops.assign(ops.empty('lol'), 'anivia', { side: 'ally', index: 0 }));
  store.create('second'); assert.equal(store.current().draft.gameId, 'lolm'); assert.equal(ops.count(store.current().draft), 0);
  store.select(first); assert.equal(store.current().draft.gameId, 'lol'); assert.equal(store.current().draft.ally[0], 'anivia');
});
