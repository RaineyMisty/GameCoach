const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function setup(locale='en') {
  const ctx={window:{dispatchEvent(){},addEventListener(){}},localStorage:{getItem:()=>locale},Event,CustomEvent,structuredClone,URL,setTimeout,clearTimeout,AbortController,DOMException,performance,TextDecoder};
  vm.createContext(ctx);
  for(const file of ['resources/lol/champions.js','resources/lolm/champions.js','resources/lol/knowledge.js','resources/lolm/knowledge.js','resources/lol/english.js',
    'frontend/translations.js','frontend/i18n.js','frontend/data.js','frontend/draft.js','memory/defaults.js','memory/locales.js','memory/index.js','memory/retrieve.js',
    'ai-core/demo.js', 'ai-core/index.js','ai-core/gemini.js','skill/index.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  const w=ctx.window, draft=w.GameCoachDraft.empty('lolm'), ids=w.GameCoachGames.get('lolm').champions.slice(0,10).map(hero=>hero.id);
  draft.ally=ids.slice(0,5); draft.enemy=ids.slice(5); return {...w,draft,ctx};
}
const packed = messages => messages.map(message=>typeof message.content==='string'?message.content:JSON.stringify(message.content)).join('\n');
function history(draft, count=10, length=1000) {
  return Array.from({length:count},(_,i)=>[{role:'user',content:'question-'+i,draft},
    {id:'answer-'+i,role:'assistant',content:('answer-'+i+' ').padEnd(length,'x')}]).flat();
}
test('Coach sends no skill snapshots for drafting, ordinary analysis, casual chat or generic expansions in either language',()=>{
  for(const locale of ['en','zh-CN']) {
    const w=setup(locale), context={draft:w.draft,memory:w.GameCoachMemory.seed()};
    for(const question of ['Analyze this lineup','Which support should I pick?','Corki support with Cho\'Gath','Explain further','Hello','分析这套阵容','飞机辅助怎么打','选什么','为什么呢？']) {
      const request=w.GameCoachSkillInput.build(question,context,{mode:'coach'});
      assert.equal(request.sources.length,0,question); assert.ok(!/官方技能快照|Official ability snapshot/.test(packed(request.messages)),question);
    }
    const request=w.GameCoachSkillInput.build('展开解释',{...context,expansion:{question:'飞机辅助怎么打',answer:'库奇的技能与科加斯有配合',draft:w.draft}},{mode:'coach'});
    assert.equal(request.sources.length,0);
  }
});
test('explicit mechanics requests attach at most two heroes and 1,600 characters; Q and passive request only that slot',()=>{
  for(const locale of ['en','zh-CN']) {
    const w=setup(locale), kb=w.GameCoachSkillKnowledge;
    for(const question of ['Corki skills and Cho\'Gath mechanics with Ahri','库奇、科加斯、阿狸的技能机制是什么？']) {
      const result=kb.collect([{role:'user',content:question}],{draft:w.draft},{mode:'coach'});
      assert.ok(result.sources.length>0 && result.sources.length<=2); assert.ok(result.text.length<=1600);
    }
    const q=kb.collect([{role:'user',content:'Corki Q mechanics'}],{draft:w.draft},{mode:'coach'});
    assert.match(q.text,/Q /); assert.ok(!q.text.includes('W ')); assert.ok(!q.text.includes('R '));
    const passive=kb.collect([{role:'user',content:'库奇的被动机制是什么？'}],{draft:w.draft},{mode:'coach'});
    assert.equal(passive.sources.length,1); assert.match(passive.text,/被动/); assert.ok(!passive.text.includes('Q '));
    assert.equal(kb.collect([{role:'user',content:'这套阵容技能如何配合'}],{draft:w.draft},{mode:'coach'}).sources.length,0);
    assert.equal(kb.collect([{role:'user',content:'Analyze this lineup'}],{draft:w.draft}).sources.length,10);
  }
});
test('Coach keeps whole recent exchanges within a text budget, current input and explicit conditions survive, and caller data is unchanged',()=>{
  const w=setup(), rows=history(w.draft); rows[0].content='I am playing Corki support, do not swap';
  rows.push({role:'user',content:'  Explain this plan\nwithout changing my role.  '}); const before=plain(rows);
  const result=w.GameCoachSkillInput.build(rows,{draft:w.draft,declarations:[rows[0].content]},{mode:'coach'});
  assert.ok(result.history.omitted>0); assert.ok(!result.history.overflow);
  const retained=result.history.messages.slice(0,-1); assert.ok(retained.length<=8);
  assert.ok(retained.reduce((sum,row)=>sum+row.content.length,0)<=5000);
  for(let i=0;i<retained.length;i+=2) {assert.equal(retained[i].role,'user');assert.equal(retained[i+1].role,'assistant');}
  assert.equal(result.messages.at(-1).content,rows.at(-1).content); assert.match(packed(result.messages),/I am playing Corki support/);
  assert.match(packed(result.messages),/History shortened/); assert.deepEqual(plain(rows),before);
});
test('protected large replies and an old clicked answer stay verbatim, with an explicit soft-budget overflow flag',()=>{
  const w=setup(), rows=history(w.draft,10,6500);rows.push({role:'user',content:'Explain that answer'});
  const expansion={replyId:'answer-0',question:rows[0].content,answer:rows[1].content,draft:w.draft};
  const result=w.GameCoachSkillInput.build(rows,{draft:w.draft,expansion},{mode:'coach'});
  assert.ok(result.history.overflow);assert.equal(result.messages.filter(row=>row.content===expansion.answer).length,1);
  assert.ok(result.messages.some(row=>row.content===rows.at(-2).content)); assert.equal(packed(result.messages).split(expansion.question).length-1,1);
  const target=result.messages.findIndex(row=>row.content===expansion.answer);assert.match(result.messages[target-1].content,/Follow-up target/);
});
test('Coach memory is smaller and used-memory/source metadata exactly describe a single preparation pass',async()=>{
  const w=setup(), memory=w.GameCoachMemory.seed(); let collectCalls=0, selectCalls=0, seen;
  const collect=w.GameCoachSkillKnowledge.collect, select=w.GameCoachMemoryRetrieval.select;
  w.ctx.window.GameCoachSkillKnowledge={...w.GameCoachSkillKnowledge,collect(...args){collectCalls++;return collect(...args);}};
  w.ctx.window.GameCoachMemoryRetrieval={...w.GameCoachMemoryRetrieval,select(...args){selectCalls++;return select(...args);}};
  w.GameCoachAI.registerProvider('capture',{async generate(request){seen=request;return{content:'answer'};}});w.GameCoachAI.configure({provider:'capture'});
  const answer=await w.GameCoachSkill.run('Analyze this lineup',{mode:'coach',context:{draft:w.draft,memory}});
  assert.equal(collectCalls,1);assert.equal(selectCalls,1);assert.equal(answer.sources.length,0);assert.ok(answer.usedMemories.length<=3);
  for(const item of answer.usedMemories)assert.ok(packed(seen.input).includes('['+item.id+']'));
  const result=select(memory,'Which support should I pick for this lineup?',{maxEntries:3,maxCharacters:600});
  assert.ok(result.entries.length<=3);assert.ok(result.characters<850);
});
test('bilingual rules are paired, short, selected once, and Quick history policy remains unchanged',()=>{
  const w=setup();assert.equal(new Set(w.GameCoachSkillRules.rules.map(rule=>rule.id)).size,w.GameCoachSkillRules.rules.length);
  assert.ok(w.GameCoachSkillRules.rules.every(rule=>rule.en && rule.zh));
  const en=w.GameCoachSkillRules.instructions;assert.match(en,/Response language: English/);assert.ok(!/[\u3400-\u9fff]/.test(en));assert.ok(en.length<1600);
  w.GameCoachI18n.setLocale('zh-CN');const zh=w.GameCoachSkillRules.instructions;assert.match(zh,/回复语言：简体中文/);assert.ok(zh.length<700);
  const rows=history(w.draft);rows.push({role:'user',content:'current'});const request=w.GameCoachSkillInput.build(rows,{draft:w.draft},{mode:'quick'});
  assert.equal(request.history.omitted,0);assert.equal(request.messages.filter(row=>row.role==='assistant').length,10);
});
test('Coach sends a smaller actual Gemini JSON request without changing the model, thinking or output limit',async()=>{
  const w=setup();let body;
  w.ctx.fetch=async(url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'answer'}]},finishReason:'STOP'}]}),{headers:{'content-type':'application/json'}});};
  w.GameCoachGemini.activate('local-test-key-never-transmitted');
  await w.GameCoachSkill.run('Analyze this lineup',{mode:'coach',context:{draft:w.draft,memory:w.GameCoachMemory.seed()}});
  const text=body.systemInstruction.parts.map(part=>part.text).join('\n')+'\n'+body.contents.flatMap(row=>row.parts.map(part=>part.text)).join('\n');
  assert.ok(text.length<3500,text.length);assert.ok(!text.includes('Official ability snapshot'));
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'MEDIUM');assert.equal(body.generationConfig.maxOutputTokens,4096);
  w.GameCoachI18n.setLocale('zh-CN');
  await w.GameCoachSkill.run('分析阵容',{mode:'coach',context:{draft:w.draft}});
  assert.ok(body.systemInstruction.parts.every(part=>!part.text.includes('Coach: Explore')));
  assert.match(body.systemInstruction.parts[0].text,/Coach：只展开/);
  w.GameCoachI18n.setLocale('en');
  await w.GameCoachSkill.run('Analyze the lineup',{mode:'coach',context:{draft:w.draft}});
  assert.ok(body.systemInstruction.parts.every(part=>!/[\u3400-\u9fff]/.test(part.text)));
});
