'use strict';
window.GameCoachDraft = (() => {
  const roles = Object.freeze([
    { id: 'top', name: '上单' }, { id: 'jungle', name: '打野' }, { id: 'mid', name: '中单' },
    { id: 'adc', name: '射手' }, { id: 'support', name: '辅助' },
  ].map(Object.freeze));
  const sides = ['ally', 'enemy'];
  const empty = () => ({ ally: Array(5).fill(null), enemy: Array(5).fill(null) });
  function normalize(value, isKnown = id => typeof id === 'string' && !!id) {
    const result = empty(); const seen = new Set();
    for (const side of sides) for (let index = 0; index < 5; index++) {
      const id = value?.[side]?.[index];
      if (typeof id === 'string' && isKnown(id) && !seen.has(id)) { result[side][index] = id; seen.add(id); }
    }
    return result;
  }
  const count = (draft, side) => (side ? [side] : sides).reduce((sum, key) => sum + (draft?.[key] || []).filter(Boolean).length, 0);
  const valid = slot => slot && sides.includes(slot.side) && Number.isInteger(slot.index) && slot.index >= 0 && slot.index < 5;
  const same = (left, right) => !!left && !!right && left.side === right.side && left.index === right.index;
  const ordinal = slot => slot.index * 2 + (slot.side === 'enemy' ? 1 : 0);
  function nextEmpty(draft, after) {
    const start = valid(after) ? ordinal(after) + 1 : 0;
    for (let offset = 0; offset < 10; offset++) {
      const order = (start + offset) % 10; const slot = { side: order % 2 ? 'enemy' : 'ally', index: Math.floor(order / 2) };
      if (!draft?.[slot.side]?.[slot.index]) return slot;
    }
    return null;
  }
  function locate(draft, id) {
    if (!id) return null;
    for (const side of sides) { const index = draft?.[side]?.indexOf(id) ?? -1; if (index >= 0) return { side, index }; }
    return null;
  }
  function move(draft, from, to) {
    if (!valid(from) || !valid(to)) throw new Error('无效的阵容位置。');
    const result = normalize(draft);
    [result[from.side][from.index], result[to.side][to.index]] = [result[to.side][to.index], result[from.side][from.index]];
    return result;
  }
  function assign(draft, id, to) {
    if (!valid(to) || typeof id !== 'string' || !id) throw new Error('请选择英雄和位置。');
    const from = locate(draft, id);
    if (from) return move(draft, from, to);
    const result = normalize(draft); result[to.side][to.index] = id; return result;
  }
  function remove(draft, slot) {
    if (!valid(slot)) throw new Error('无效的阵容位置。');
    const result = normalize(draft); result[slot.side][slot.index] = null; return result;
  }
  return Object.freeze({ roles, empty, normalize, count, nextEmpty, locate, move, assign, remove, same });
})();
