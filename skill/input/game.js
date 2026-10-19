'use strict';

// 只整理游戏事实，不决定模型、回答长度或输出样式。
window.GameCoachSkillGame = (() => {
  function describe(value) {
    if (!value || typeof value !== 'object') return '';
    const games = window.GameCoachGames;
    const gameId = value.gameId || games.resolve();
    if (!games.has(gameId)) throw new Error('这个游戏暂未接入 Skill。');
    const game = games.get(gameId);
    const heroes = new Map(game.champions.map(hero => [hero.id, hero.name]));
    const ops = window.GameCoachDraft;
    const draft = ops.normalize(value, id => heroes.has(id));
    const lines = ['游戏：' + game.name];

    for (const side of ['ally', 'enemy']) {
      const team = side === 'ally' ? '蓝' : '红';
      const picks = draft[side].flatMap((id, index) => id
        ? [(draft.bpMode ? String(index + 1) : ops.roles[index].name) + '=' + heroes.get(id)] : []);
      lines.push(team + '选：' + (picks.join('、') || '未选'));
      // 关闭 BP 或三禁规则下，保存但隐藏的 Ban 不属于本轮有效禁用。
      const bans = draft.bpMode ? draft.bans[side].slice(0, ops.banLimit(draft)).filter(Boolean) : [];
      if (bans.length) lines.push(team + '禁：' + bans.map(id => heroes.get(id)).join('、'));
    }

    if (draft.bpMode) {
      lines.push('BP：' + ops.ruleFor(draft).name + '；选人编号不代表分路');
      const next = ops.nextAction(draft)?.slot;
      if (next) lines.push('下一位：' + (next.side === 'ally' ? '蓝' : '红')
        + (next.kind === 'ban' ? '禁' : '选') + (next.index + 1));
    }
    return lines.join('\n');
  }
  return Object.freeze({ describe });
})();
