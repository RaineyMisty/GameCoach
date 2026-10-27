const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
function setup(locale, blocked = false) {
  const saved = new Map(locale ? [['gamecoach-language', locale]] : []), events = new EventTarget();
  const ctx = { window: { dispatchEvent: event => events.dispatchEvent(event), addEventListener: (...args) => events.addEventListener(...args) },
    localStorage: { getItem: key => { if (blocked) throw Error('blocked'); return saved.get(key); }, setItem: (key,value) => { if (blocked) throw Error('blocked'); saved.set(key,value); } },
    Event, CustomEvent, structuredClone, DOMException, AbortController, performance, setTimeout, clearTimeout, URL };
  vm.createContext(ctx);
  for (const file of ['resources/lol/champions.js','resources/lolm/champions.js','resources/lol/knowledge.js','resources/lolm/knowledge.js','resources/lol/english.js',
    'frontend/translations.js','frontend/i18n.js','frontend/data.js','frontend/draft.js','memory/defaults.js','memory/locales.js','memory/index.js','memory/retrieve.js','memory/commands.js',
    'frontend/storage.js','frontend/conversation.js','ai-core/index.js','ai-core/gemini.js','skill/rules.js','skill/input/game.js','skill/input/knowledge.js','skill/input/history.js', 'skill/input/prepare.js','skill/output/index.js','skill/index.js']) {
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  }
  return { ...ctx.window, saved, ctx };
}
test('English is the default, persisted Chinese is respected, blocked storage is supported', () => {
  assert.equal(setup().GameCoachI18n.locale,'en'); assert.equal(setup('zh-CN').GameCoachI18n.locale,'zh-CN');
  const w=setup(undefined,true); w.GameCoachI18n.setLocale('zh-CN'); assert.equal(w.GameCoachI18n.locale,'zh-CN');
  const normal=setup(); normal.GameCoachI18n.setLocale('zh-CN'); assert.equal(normal.saved.get('gamecoach-language'),'zh-CN');
});
test('every roster entry has an official English name and title; switching preserves draft IDs and labels', () => {
  const w=setup();
  for (const game of w.GameCoachGames.list) for(const hero of game.champions) {
    assert.ok(w.GAMECOACH_ENGLISH_CHAMPIONS[hero.id],hero.id); assert.ok(!/[\u3400-\u9fff]/.test(hero.name+' '+hero.title),hero.id);
    assert.ok(hero.aliases.some(alias=>/[\u3400-\u9fff]/.test(alias)),hero.id);
  }
  assert.equal(w.GameCoachGames.get('lol').champions.find(hero=>hero.id==='monkeyking')?.name ?? w.GameCoachGames.get('lol').champions.find(hero=>hero.id==='wukong')?.name,'Wukong');
  const draft=w.GameCoachDraft.empty('lolm'); draft.ally[0]='aatrox'; w.GCStore.saveDraft(draft);
  const before=JSON.stringify(w.GCStore.exportUser().user);
  assert.equal(w.GameCoachDraft.roles[0].name,'Top');
  w.GameCoachI18n.setLocale('zh-CN'); assert.equal(w.GameCoachDraft.roles[0].name,'上单'); assert.match(w.GameCoachDraft.rules[0].name,/蓝方先选/);
  assert.equal(w.GameCoachGames.get('lolm').champions.find(hero=>hero.id==='aatrox').name,'亚托克斯');
  assert.equal(JSON.stringify(w.GCStore.exportUser().user),before);
});
test('English Skill payload requests English, uses official names, and preserves user content', () => {
  const w=setup(), draft=w.GameCoachDraft.empty('lol'); draft.ally[0]='chogath'; draft.enemy[0]='malphite';
  const prepared=w.GameCoachSkill.prepare('我的原文 stays unchanged',{draft,memory:w.GameCoachMemory.seed()});
  const text=prepared.map(message=>message.content).join('\n');
  assert.match(prepared[0].content,/Response language: English/); assert.match(text,/Cho'Gath/); assert.match(text,/Malphite/); assert.equal(prepared.at(-1).content,'我的原文 stays unchanged');
  w.GameCoachI18n.setLocale('zh-CN'); assert.match(w.GameCoachSkill.prepare('选什么',{draft})[0].content,/回复语言：简体中文/);
});
test('English questions retrieve relevant weak memories, but greetings and ordinary drafts do not assume profile role', () => {
  const w=setup(), memory=w.GameCoachMemory.withProfile(w.GameCoachMemory.seed(),{role:'support',championPool:['lulu']});
  const result=w.GameCoachMemoryRetrieval.select(memory,'Which support should I pick for our composition?');
  assert.ok(result.entries.some(item=>item.id==='analysis-support')); assert.ok(!result.entries.some(item=>item.id==='profile-role'));
  assert.match(result.text,/Optional long-term memory/); assert.ok(result.characters<1600);
  assert.equal(w.GameCoachMemoryRetrieval.select(memory,'Thanks, that was helpful!').entries.length,0);
  assert.ok(w.GameCoachMemoryRetrieval.select(memory,'Recommend something for my champion pool').entries.some(item=>item.id==='profile-championPool'));
});
test('only untouched built-in memories are localized; personal edits and exports preserve user text', () => {
  const w=setup(), memory=w.GameCoachMemory.seed(), item=memory.entries[0];
  assert.equal(w.GameCoachMemory.display(item).title,'Support picks');
  const edited=w.GameCoachMemory.save(memory,{...item,title:'我的标题',text:'我自己的文字 support preference'});
  assert.equal(w.GameCoachMemory.display(edited.entries[0]).text,'我自己的文字 support preference');
  assert.match(w.GameCoachMemory.markdown(edited),/我自己的文字 support preference/);
  w.GameCoachI18n.setLocale('zh-CN'); assert.equal(w.GameCoachMemory.display(item).title,'辅助选人');
});
test('Remember and Forget work in English without a model call or rewriting saved text', () => {
  const w=setup(); const added=w.GameCoachMemoryCommands.apply(w.GameCoachMemory.seed(),'Remember: Consider creative support synergies');
  assert.equal(added.handled,true); assert.match(added.notice,/Saved to local memory/);
  const entry=added.memory.entries.at(-1); assert.equal(entry.text,'Consider creative support synergies');
  const removed=w.GameCoachMemoryCommands.apply(added.memory,'Forget: '+entry.id); assert.equal(removed.handled,true); assert.ok(!removed.memory.entries.some(item=>item.id===entry.id));
});
test('localized errors and demos do not require an API key',async()=>{
  const w=setup(); assert.throws(()=>w.GameCoachGemini.activate('bad'),/Invalid key format/);
  const response=await w.GameCoachSkill.run('Hello'); assert.match(response.content,/Demo: Received/);
  w.GameCoachI18n.setLocale('zh-CN'); const zh=await w.GameCoachSkill.run('你好'); assert.match(zh.content,/演示/);
});
