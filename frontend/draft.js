'use strict';
window.GameCoachDraft = (() => {
  const roles = Object.freeze([
    { id: 'top', name: '上单' }, { id: 'jungle', name: '打野' }, { id: 'mid', name: '中单' },
    { id: 'adc', name: '射手' }, { id: 'support', name: '辅助' },
  ].map(Object.freeze));
  const sides = ['ally', 'enemy'];
  const rules = Object.freeze([
    { type: 'five', name: '5 禁后 5 选', bans: 5 },
    { type: 'split', name: '分段 3 禁 → 3 选 → 2 禁 → 2 选', bans: 5 },
    { type: 'three', name: '3 禁后 5 选', bans: 3 },
  ].flatMap(rule => sides.map(first => Object.freeze({ ...rule, id: rule.type + '-' + first, first,
    name: rule.name + ' · ' + (first === 'ally' ? '蓝方' : '红方') + '先选' }))));
  const ruleFor = draft => rules.find(rule => rule.id === draft?.bpRule) || rules[0];
  const banLimit = draft => ruleFor(draft).bans;
  const gameIdFor = id => window.GameCoachGames ? window.GameCoachGames.resolve(id) : ['lol', 'lolm'].includes(id) ? id : 'lolm';
  const empty = (gameId = 'lolm') => ({ gameId: gameIdFor(gameId), ally: Array(5).fill(null), enemy: Array(5).fill(null), bpMode: false, bpRule: rules[0].id,
    bans: { ally: Array(5).fill(null), enemy: Array(5).fill(null) } });
  const kindOf = slot => slot?.kind === 'ban' ? 'ban' : 'pick';
  const row = (draft, side, kind = 'pick') => kind === 'ban' ? draft?.bans?.[side] : draft?.[side];
  const valid = slot => slot && sides.includes(slot.side) && Number.isInteger(slot.index) && slot.index >= 0 && slot.index < 5 && (!slot.kind || ['pick', 'ban'].includes(slot.kind));
  const same = (left, right) => !!left && !!right && left.side === right.side && left.index === right.index && kindOf(left) === kindOf(right);
  function normalize(value, isKnown = id => typeof id === 'string' && !!id) {
    const result = empty(value?.gameId); result.bpMode = value?.bpMode === true; result.bpRule = ruleFor(value).id;
    const globalPicks = new Set();
    for (const side of sides) {
      const seen = result.bpMode ? globalPicks : new Set();
      for (let index = 0; index < 5; index++) {
        const id = value?.[side]?.[index];
        if (typeof id === 'string' && isKnown(id) && !seen.has(id)) { result[side][index] = id; seen.add(id); globalPicks.add(id); }
      }
    }
    const banned = new Set();
    for (const side of sides) for (let index = 0; index < 5; index++) {
      const id = value?.bans?.[side]?.[index];
      if (typeof id === 'string' && isKnown(id) && !globalPicks.has(id) && !banned.has(id)) { result.bans[side][index] = id; banned.add(id); }
    }
    return result;
  }
  const count = (draft, side, kind = 'pick') => (side ? [side] : sides).reduce((sum, key) => sum + (row(draft, key, kind) || []).filter(Boolean).length, 0);
  const ordinal = slot => slot.index * 2 + (slot.side === 'enemy' ? 1 : 0);
  function nextEmpty(draft, after, kind = 'pick') {
    const start = valid(after) ? ordinal(after) + 1 : 0;
    for (let offset = 0; offset < 10; offset++) {
      const order = (start + offset) % 10; const slot = { side: order % 2 ? 'enemy' : 'ally', index: Math.floor(order / 2) };
      if (kind === 'ban') slot.kind = 'ban';
      if (!row(draft, slot.side, kind)?.[slot.index]) return slot;
    }
    return null;
  }
  // A is the chosen first-pick team, B the other team. The split template follows
  // tournament draft: bans ABABAB, picks ABBAAB, bans BABA, picks BAAB.
  function sequence(draft) {
    const rule = ruleFor(draft); const team = { A: rule.first, B: rule.first === 'ally' ? 'enemy' : 'ally' };
    const indices = { pick: { ally: 0, enemy: 0 }, ban: { ally: 0, enemy: 0 } }; const result = [];
    function phase(kind, order, name) {
      for (const letter of order) {
        const side = team[letter]; const slot = { side, index: indices[kind][side]++ };
        if (kind === 'ban') slot.kind = 'ban';
        result.push({ slot, phase: name, step: result.length + 1 });
      }
    }
    if (rule.type === 'split') {
      phase('ban', 'ABABAB', '第一轮禁用'); phase('pick', 'ABBAAB', '第一轮选人');
      phase('ban', 'BABA', '第二轮禁用'); phase('pick', 'BAAB', '第二轮选人');
    } else {
      phase('ban', 'AB'.repeat(rule.bans), '禁用阶段'); phase('pick', 'ABBAABBAAB', '选人阶段');
    }
    return result.map(action => ({ ...action, total: result.length }));
  }
  const nextAction = draft => draft?.bpMode ? sequence(draft).find(action => !row(draft, action.slot.side, kindOf(action.slot))?.[action.slot.index]) || null : null;
  const activeBan = (draft, id) => sides.some(side => (draft.bans?.[side] || []).slice(0, banLimit(draft)).includes(id));
  function locate(draft, id, sideOnly, kind = 'pick') {
    if (!id) return null;
    for (const side of sideOnly ? sides.filter(side => side === sideOnly) : sides) {
      const index = row(draft, side, kind)?.indexOf(id) ?? -1;
      if (index >= 0) return kind === 'ban' ? { side, index, kind } : { side, index };
    }
    return null;
  }
  function assertLegal(draft) {
    const globalPicks = new Set();
    for (const side of sides) {
      const seen = draft.bpMode ? globalPicks : new Set();
      for (const id of draft[side].filter(Boolean)) {
        if (seen.has(id)) throw new Error(draft.bpMode ? 'BP 模式双方不能选择重复英雄。' : '同一队不能出现重复英雄，请换一个位置。');
        seen.add(id); globalPicks.add(id);
      }
    }
    const banned = new Set();
    for (const side of sides) for (const id of draft.bans[side].filter(Boolean)) {
      if (globalPicks.has(id)) throw new Error('已选英雄不能被禁用。');
      if (banned.has(id)) throw new Error('该英雄已经被禁用。');
      banned.add(id);
    }
  }
  function move(draft, from, to) {
    if (!valid(from) || !valid(to)) throw new Error('无效的阵容位置。');
    const result = normalize(draft); const banSlots = [from, to].filter(slot => kindOf(slot) === 'ban');
    if (banSlots.length && !result.bpMode) throw new Error('请先开启 BP 模式。');
    if (banSlots.some(slot => slot.index >= banLimit(result))) throw new Error('当前规则没有这个禁用位。');
    const source = row(result, from.side, kindOf(from)); const target = row(result, to.side, kindOf(to));
    [source[from.index], target[to.index]] = [target[to.index], source[from.index]];
    assertLegal(result); return result;
  }
  function assign(draft, id, to) {
    if (!valid(to) || kindOf(to) !== 'pick' || typeof id !== 'string' || !id) throw new Error('请选择英雄和位置。');
    const result = normalize(draft);
    if (result.bpMode && activeBan(result, id)) throw new Error('该英雄已被禁用，不能在 BP 模式选择。');
    const from = locate(result, id, result.bpMode ? undefined : to.side);
    if (from) return move(result, from, to);
    result[to.side][to.index] = id;
    // Picking a previously banned champion in normal mode retires its saved ban.
    for (const side of sides) result.bans[side] = result.bans[side].map(banned => banned === id ? null : banned);
    assertLegal(result); return result;
  }
  function assignBan(draft, id, to) {
    if (!valid(to) || kindOf(to) !== 'ban' || typeof id !== 'string' || !id) throw new Error('请选择禁用位和英雄。');
    const result = normalize(draft);
    if (!result.bpMode) throw new Error('请先开启 BP 模式。');
    if (to.index >= banLimit(result)) throw new Error('当前规则没有这个禁用位。');
    if (locate(result, id)) throw new Error('已选英雄不能被禁用。');
    const from = locate(result, id, undefined, 'ban');
    if (from && from.index < banLimit(result)) return move(result, from, to);
    if (from) result.bans[from.side][from.index] = null;
    result.bans[to.side][to.index] = id; assertLegal(result); return result;
  }
  function remove(draft, slot) {
    if (!valid(slot)) throw new Error('无效的阵容位置。');
    const result = normalize(draft); row(result, slot.side, kindOf(slot))[slot.index] = null; return result;
  }
  const setBPMode = (draft, enabled) => normalize({ ...draft, bpMode: enabled === true });
  const setRule = (draft, id) => normalize({ ...draft, bpRule: id });
  const clear = draft => ({ ...empty(draft?.gameId), bpMode: draft?.bpMode === true, bpRule: ruleFor(draft).id });
  return Object.freeze({ roles, rules, ruleFor, banLimit, sequence, nextAction, activeBan, empty, normalize, count, nextEmpty, locate, move, assign, assignBan, remove, same, setBPMode, setRule, clear });
})();
