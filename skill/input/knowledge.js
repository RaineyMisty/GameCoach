'use strict';

window.GameCoachSkillKnowledge = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  const plain = content => typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(part => typeof part?.text === 'string').map(part => part.text).join(' ') : '';
  // 只决定是否取资料，不把用户问题分流为另一种任务，也不增加一次分类模型调用。
  function wantsSearch(input, setting = 'auto') {
    if (setting === 'off') return false;
    if (setting === 'on') return true;
    const question = plain(typeof input === 'string' ? input : Array.isArray(input) ? input.at(-1)?.content : '');
    return /最新|当前版本|现在的版本|更新|重做|上线|实装|联网|查一下|查一查|搜一下|查资料|核实|patch|latest|search|look up/i.test(question);
  }
  // Coach normally needs the lineup, not a skill encyclopedia. Explicit
  // mechanics questions opt in; a champion name or "explain" alone does not.
  function needsSkills(question) {
    return /技能|机制|被动|冷却|数值|系数|连招|射程|施法距离|\babilit(?:y|ies)\b|\bskills?\b|\bmechanics?\b|\bpassive\b|\bcooldown\b|\bcombo\b|\bratios?\b|\bscaling ratios?\b|\b[QWER]\b|(?:base|ability) damage|damage (?:numbers?|calculation)|[QWER](?:技能|怎么|能否|可以|会)/i.test(question);
  }
  function collect(messages, context = {}, { mode = 'quick' } = {}) {
    if (!context.draft) return { text: '', sources: [] };
    const gameId = context.draft?.gameId || 'lolm';
    const game = window.GameCoachGames?.get(gameId);
    const data = window.GAMECOACH_KNOWLEDGE?.[gameId];
    if (!game || !data) return { text: '', sources: [] };
    const question = plain(messages.at(-1)?.content);
    const compact = mode === 'coach';
    if (compact && !needsSkills(question)) return { text: '', sources: [] };
    // Expansion answer text is a reference, not a request to load every champion
    // it happened to mention. Resolve short mechanics follow-ups from user text.
    let relevant = question + '\n' + (context.expansion ? context.expansion.question + (compact ? '' : '\n' + context.expansion.answer) : '');
    const findNamed = value => game.champions.filter(hero => [hero.id, hero.name, hero.englishName, ...(hero.aliases || [])].some(alias => {
      if (!alias || alias.length < 2) return false;
      return /^[\x20-\x7e]+$/.test(alias)
        ? new RegExp('(^|[^a-z])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i').test(value)
        : value.includes(alias);
    })).map(hero => hero.id);
    let named = findNamed(relevant);
    // “前三级呢 / 为什么”可承接最近用户提过的英雄；不从 AI 旧回答提取新事实。
    // 闲聊与“现在呢”不据此拉入旧游戏资料。
    if (!named.length && !context.expansion && /前[一二三四五六123456]|为什么|为啥|怎么(?:玩|打|做|配合)|对线|出装|技能|伤害|经济|连招|具体|展开|解释|什么意思|接下来|why|how.*play|laning|build|abilit|damage|economy|combo|explain|expand|what next/i.test(question)) {
      relevant += '\n' + messages.slice(0, -1).filter(message => message.role === 'user').slice(-2).map(message => plain(message.content)).join('\n');
      named = findNamed(relevant);
    }
    const draft = context.draft;
    const ids = [...named];
    // 明确的普通分路问题可取对应英雄；BP 编号不作分路推断。
    const role = window.GameCoachDraft?.roles.find(role => question.toLowerCase().includes(role.name.toLowerCase()));
    if (draft && !draft.bpMode && role && /我|蓝方|红方|\bmy\b|blue team|red team/i.test(question)) {
      const side = /红方|red team/i.test(question) ? 'enemy' : /蓝方|blue team/i.test(question) ? 'ally' : null;
      if (side) ids.unshift(draft[side]?.[window.GameCoachDraft.roles.indexOf(role)]);
    }
    if (!compact && !ids.filter(Boolean).length && /阵容|配合|这套|这把怎么打|lineup|composition|synergy|how.*play this/i.test(question) && draft) ids.push(...draft.ally, ...draft.enemy);
    const header = tr("【官方技能快照 {0}；采集 {1}】\n{2}\n", data.version, data.fetchedOn, data.note)
      + (compact ? window.GameCoachI18n?.locale === 'en' ? 'Selected skill excerpts only.\n' : '仅附相关技能节选。\n' : '');
    const blocks = [], sources = []; let remaining = compact ? 1600 - header.length : 4800;
    const uniqueIds = [...new Set(ids.filter(Boolean))].slice(0, compact ? 2 : Infinity);
    const requestedSlot = /\b([QWER])\b|([QWER])(?:技能|怎么|能否|可以|会)/i.exec(question);
    for (const id of uniqueIds) {
      const hero = data.champions[id]; if (!hero) continue;
      // 具名提问优先给完整描述；整套阵容只取短节选，控制输入成本。
      // 为多个英雄平分资料空间，避免前几个长技能挤掉后面的英雄。
      // 3600 字用于技能正文，其余预算留给技能名、英雄名和节选标记。
      const skills = compact && requestedSlot ? hero.skills.filter(skill => skill.slot.toUpperCase() === (requestedSlot[1] || requestedSlot[2]).toUpperCase())
        : compact && /被动|\bpassive\b/i.test(question) ? hero.skills.filter(skill => ['p', 'passive', '被动'].includes(skill.slot.toLowerCase())) : hero.skills;
      if (!skills.length) continue;
      const limit = compact ? Math.min(220, Math.floor(Math.max(0, remaining / uniqueIds.length - 120) / skills.length))
        : Math.min(uniqueIds.length <= 3 ? 600 : 80, Math.floor(3600 / uniqueIds.length / 5));
      const name = game.champions.find(champion => champion.id === id)?.name || hero.name;
      const body = name + '：' + skills.map(skill => skill.slot + ' ' + skill.name + '：'
        + (skill.text.length > limit ? skill.text.slice(0, limit) + tr("…（节选）") : skill.text)).join('；');
      if (body.length > remaining) break;
      blocks.push(body); remaining -= body.length + 1;
      sources.push({ title: name + tr(" · 官方技能资料"), url: hero.source, kind: 'local', gameId,
        version: data.version, fetchedOn: data.fetchedOn });
    }
    return { text: blocks.length ? header + blocks.join('\n') : '', sources };
  }
  return Object.freeze({ plain, wantsSearch, needsSkills, collect });
})();
