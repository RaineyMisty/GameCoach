'use strict';

window.GameCoachSkillKnowledge = (() => {
  const plain = content => typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(part => typeof part?.text === 'string').map(part => part.text).join(' ') : '';
  // 只决定是否取资料，不把用户问题分流为另一种任务，也不增加一次分类模型调用。
  function wantsSearch(input, setting = 'auto') {
    if (setting === 'off') return false;
    if (setting === 'on') return true;
    const question = plain(typeof input === 'string' ? input : Array.isArray(input) ? input.at(-1)?.content : '');
    return /最新|当前版本|现在的版本|更新|重做|上线|实装|联网|查一下|查一查|搜一下|查资料|核实|patch|latest|search|look up/i.test(question);
  }
  function collect(messages, context = {}) {
    if (!context.draft) return { text: '', sources: [] };
    const gameId = context.draft?.gameId || 'lolm';
    const game = window.GameCoachGames?.get(gameId);
    const data = window.GAMECOACH_KNOWLEDGE?.[gameId];
    if (!game || !data) return { text: '', sources: [] };
    const question = plain(messages.at(-1)?.content);
    let relevant = question + '\n' + (context.expansion ? context.expansion.question + '\n' + context.expansion.answer : '');
    const findNamed = value => game.champions.filter(hero => [hero.id, hero.name, hero.englishName, ...(hero.aliases || [])].some(alias => {
      if (!alias || alias.length < 2) return false;
      return /^[a-z -]+$/i.test(alias)
        ? new RegExp('(^|[^a-z])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i').test(value)
        : value.includes(alias);
    })).map(hero => hero.id);
    let named = findNamed(relevant);
    // “前三级呢 / 为什么”可承接最近用户提过的英雄；不从 AI 旧回答提取新事实。
    // 闲聊与“现在呢”不据此拉入旧游戏资料。
    if (!named.length && !context.expansion && /前[一二三四五六123456]|为什么|为啥|怎么(?:玩|打|做|配合)|对线|出装|技能|伤害|经济|连招|具体|展开|解释|什么意思|接下来/.test(question)) {
      relevant += '\n' + messages.slice(0, -1).filter(message => message.role === 'user').slice(-2).map(message => plain(message.content)).join('\n');
      named = findNamed(relevant);
    }
    const draft = context.draft;
    const ids = [...named];
    // 明确的普通分路问题可取对应英雄；BP 编号不作分路推断。
    const role = window.GameCoachDraft?.roles.find(role => question.includes(role.name));
    if (draft && !draft.bpMode && role && /我|蓝方|红方/.test(question)) {
      const side = question.includes('红方') ? 'enemy' : question.includes('蓝方') ? 'ally' : null;
      if (side) ids.unshift(draft[side]?.[window.GameCoachDraft.roles.indexOf(role)]);
    }
    if (!ids.filter(Boolean).length && /阵容|配合|这套|这把怎么打/.test(question) && draft) ids.push(...draft.ally, ...draft.enemy);
    const blocks = [], sources = []; let remaining = 4800;
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    for (const id of uniqueIds) {
      const hero = data.champions[id]; if (!hero) continue;
      // 具名提问优先给完整描述；整套阵容只取短节选，控制输入成本。
      // 为多个英雄平分资料空间，避免前几个长技能挤掉后面的英雄。
      // 3600 字用于技能正文，其余预算留给技能名、英雄名和节选标记。
      const limit = Math.min(uniqueIds.length <= 3 ? 600 : 80, Math.floor(3600 / uniqueIds.length / 5));
      const body = hero.name + '：' + hero.skills.map(skill => skill.slot + ' ' + skill.name + '：'
        + (skill.text.length > limit ? skill.text.slice(0, limit) + '…（节选）' : skill.text)).join('；');
      if (body.length > remaining) break;
      blocks.push(body); remaining -= body.length;
      sources.push({ title: hero.name + ' · 官方技能资料', url: hero.source, kind: 'local', gameId,
        version: data.version, fetchedOn: data.fetchedOn });
    }
    return { text: blocks.length ? `【官方技能快照 ${data.version}；采集 ${data.fetchedOn}】\n${data.note}\n` + blocks.join('\n') : '', sources };
  }
  return Object.freeze({ plain, wantsSearch, collect });
})();
