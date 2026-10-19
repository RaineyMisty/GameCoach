'use strict';

// Whole-turn selection, not an AI summary. Never shorten a retained message.
window.GameCoachSkillHistory = (() => {
  const size = content => typeof content === 'string' ? content.length : Array.isArray(content)
    ? content.reduce((sum, part) => sum + (typeof part?.text === 'string' ? part.text.length : 0), 0) : 0;
  const limits = Object.freeze({ characters: 5000, messages: 8 });
  function select(messages, { mode = 'quick', expansion } = {}) {
    if (mode !== 'coach' || messages.length < 2) return { messages, omitted: 0, overflow: false };
    const latest = messages.at(-1), instructions = [], groups = [];
    for (const message of messages.slice(0, -1)) {
      if (['system', 'developer'].includes(message.role)) { instructions.push(message); continue; }
      if (message.role === 'user' || !groups.length) groups.push([]);
      groups.at(-1).push(message);
    }
    const selected = new Set();
    // Protect the preceding exchange and explicitly selected answer, even if
    // unusually long. This is a soft text budget, not an exact token limit.
    for (const [index, group] of groups.entries()) if (index === groups.length - 1 ||
      (expansion?.replyId && group.some(message => message.id === expansion.replyId))) selected.add(index);
    let used = [...selected].reduce((sum, index) => ({ characters: sum.characters + groups[index].reduce((n, message) => n + size(message.content), 0),
      messages: sum.messages + groups[index].length }), { characters: 0, messages: 0 });
    for (let index = groups.length - 1; index >= 0; index--) {
      if (selected.has(index)) continue;
      const group = groups[index], characters = group.reduce((sum, message) => sum + size(message.content), 0);
      if (used.characters + characters > limits.characters || used.messages + group.length > limits.messages) break;
      selected.add(index); used.characters += characters; used.messages += group.length;
    }
    const retained = groups.flatMap((group, index) => selected.has(index) ? group : []);
    return { messages: [...instructions, ...retained, latest], omitted: groups.flat().length - retained.length,
      overflow: used.characters > limits.characters || used.messages > limits.messages };
  }
  return Object.freeze({ select, limits });
})();
