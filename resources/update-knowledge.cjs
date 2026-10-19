const fs = require('node:fs/promises'), path = require('node:path'), vm = require('node:vm');
// Optional maintainer tool: node resources/update-knowledge.cjs [lol|lolm]
// The webpage itself needs neither Node nor this script.
const root = path.resolve(__dirname, '..');
const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
async function json(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error('HTTP ' + response.status);
    return await response.json();
  } catch (error) { last = error; }
  throw last;
}
(async () => {
  const context = { window: {} }; vm.createContext(context);
  for (const file of ['resources/lol/champions.js', 'resources/lolm/champions.js']) vm.runInContext(await fs.readFile(path.join(root, file), 'utf8'), context);
  const selected = process.argv[2];
  if (selected && !['lol', 'lolm'].includes(selected)) throw Error('Use lol or lolm, or omit to update both.');
  const mobile = !selected || selected === 'lolm'
    ? await json('https://game.gtimg.cn/images/lgamem/act/lrlib/js/heroList/hero_list.js') : null;
  const pcVersion = !selected || selected === 'lol'
    ? (await json('https://ddragon.leagueoflegends.com/api/versions.json'))[0] : null;
  const normalize = s => clean(s).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  for (const gameId of selected ? [selected] : ['lol', 'lolm']) {
    const heroes = context.window.GAMECOACH_SOURCES[gameId].champions;
    const output = { gameId, version: gameId === 'lol' ? pcVersion : mobile.version,
      fetchedOn: new Date().toISOString().slice(0, 10), note: '官方资料快照，非实时比赛版本；技能数值可能为基础等级，不代表完整伤害计算。', champions: {} };
    let cursor = 0; const failures = [];
    async function worker() {
      while (cursor < heroes.length) {
        const hero = heroes[cursor++];
        try {
          let source, skills;
          if (gameId === 'lol') {
            const key = hero.sourcePortrait.split('/').at(-1).replace('.png', '');
            source = `https://ddragon.leagueoflegends.com/cdn/${pcVersion}/data/zh_CN/champion/${key}.json`;
            const data = Object.values((await json(source)).data)[0];
            skills = [{ slot: '被动', name: data.passive.name, text: clean(data.passive.description) },
              ...data.spells.map((spell, index) => ({ slot: ['Q', 'W', 'E', 'R'][index], name: spell.name, text: clean(spell.description) }))];
          } else {
            const entry = Object.values(mobile.heroList).find(value => value.name === hero.name || value.title === hero.title || normalize(value.alias) === normalize(hero.id) || value.avatar === hero.sourcePortrait);
            if (!entry) throw Error('No official hero mapping');
            source = `https://mlol.qt.qq.com/go/lgame_battle_info/hero_tech?hero_id=${entry.heroId}&mode=classic_model&source_game_zone=lgame&game_zone=lgame`;
            const response = await json(source); const info = response.data?.skill_introduce;
            if (!info?.icon_list?.length) throw Error('Official skill data unavailable');
            skills = info.icon_list.map((item, index) => { const skill = info.content_map[item.id];
              return { slot: ['被动', 'Q', 'W', 'E', 'R'][index] || String(index), name: clean(skill.name), text: clean(skill.content) }; });
          }
          output.champions[hero.id] = { name: hero.name, source, skills };
        } catch (error) { failures.push({ id: hero.id, error: error.message }); }
        if (Object.keys(output.champions).length % 35 === 0) console.log(gameId, Object.keys(output.champions).length, '/', heroes.length);
      }
    }
    await Promise.all(Array.from({ length: 5 }, worker));
    output.missing = failures;
    // Do not replace a complete snapshot with a partially downloaded one.
    if (failures.length) throw Error(gameId + ': keeping existing snapshot; failed heroes: ' + failures.map(item => item.id).join(', '));
    const dest = path.join(root, 'resources', gameId, 'knowledge.js');
    const temporary = dest + '.tmp';
    await fs.writeFile(temporary, `window.GAMECOACH_KNOWLEDGE ||= {};\nwindow.GAMECOACH_KNOWLEDGE.${gameId} = ${JSON.stringify(output, null, 2)};\n`);
    await fs.rename(temporary, dest);
    console.log(JSON.stringify({ gameId, count: Object.keys(output.champions).length, failures, version: output.version }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
