'use strict';

window.GameCoachMemoryRetrieval = (() => {
  const plain = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => part?.text || '').join(' ') : '';
  const patterns = {
    support: /辅助|选辅|support/i, jungle: /打野|上半区|下半区|野区|入侵|控龙|jungle/i,
    carries: /双\s*c|中下|强势期|发育|射手|adc|carr(?:y|ies)|power spike|farm|bot lane/i, development: /阵容|团战|单带|前期|中期|后期|节奏|赢法|配合|怎么打|composition|lineup|teamfight|split.?push|early game|mid game|late game|scaling|tempo|win condition|synergy|how.*play/i,
    opponent: /对手|对面|反制|克制|破解|应对|风险|代价|opponent|counter|respond|risk|trade.?off/i,
    draft: /选什么|选啥|选谁|选人|选择.*英雄|英雄.*选择|推荐|补什么|补谁|阵容|\bbp\b|禁选|\bpick\b|\bdraft\b|\bban\b|recommend|composition|lineup/i,
    review: /复盘|战报|赢了|输了|这局赢|这把赢|打几分|评价|可行|能玩吗|review|we won|we lost|I won|I lost|evaluate|viable/i,
  };
  function select(raw, input, { expansion, draft } = {}) {
    if (!raw) return { text: '', entries: [], characters: 0 };
    const memory = window.GameCoachMemory.normalize(raw);
    if (!memory.enabled) return { text: '', entries: [], characters: 0 };
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
    const question = plain(messages.at(-1)?.content);
    let query = question;
    if (expansion) query += '\n' + plain(expansion.question) + '\n' + plain(expansion.answer);
    else if (/为什么|为啥|前[一二三四五六123456]|具体|展开|解释|接下来|怎么(?:玩|打)|why|explain|expand|what next|how.*play/i.test(question)) {
      // Use recent user context, never inferred facts from old assistant replies.
      query += '\n' + messages.slice(0, -1).filter(message => message.role === 'user').slice(-2).map(message => plain(message.content)).join('\n');
    }
    const active = Object.keys(patterns).filter(topic => patterns[topic].test(query));
    const personal = /我的(?:英雄池|段位|水平|位置|偏好|习惯|资料|记忆)|结合我|适合我|按我(?:的|会)|常用|熟悉|英雄池|段位|水平|操作难度|你记得我|你记住.*我|my (?:pool|rank|skill|role|preferences|profile|memory)|suit me|for my|remember.*me|champion pool|mechanical difficulty/i.test(question);
    const game = !!active.length;
    // A selected BP alone must not turn greetings/status enquiries into analysis.
    const candidates = memory.entries.filter(item => item.enabled).map((item, index) => {
      if (item.kind === 'profile' && item.field !== 'preferences') return { item, index, score: personal ? 15 : 0 };
      const matches = item.topics.filter(topic => active.includes(topic)).length;
      const general = item.topics.includes('general') && game;
      const player = item.topics.includes('player') && personal;
      return { item, index, score: matches * 4 + (general ? 2 : 0) + (player ? 10 : 0) };
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = []; let remaining = window.GameCoachI18n?.locale === 'en' ? 1300 : 1400;
    for (const candidate of candidates) {
      const item = window.GameCoachMemory.display(candidate.item);
      if (selected.length >= 6 || remaining < 80) break;
      const allowance = Math.min(400, remaining - item.title.length - 20);
      const excerpt = item.text.length > allowance ? item.text.slice(0, allowance - 5) + '…（节选）' : item.text;
      const line = '[' + item.id + '] ' + item.title + '：' + excerpt;
      if (line.length > remaining) continue;
      selected.push({ id: item.id, title: item.title, text: excerpt, line }); remaining -= line.length;
    }
    const header = window.GameCoachI18n?.locale === 'en' ? '[Optional long-term memory]\nGuidance, not match facts or a checklist. Use only what is relevant; the current question and lineup take priority. Usual roles and familiar champions do not restrict this game.\n'
      : '【长期记忆·可选参考】\n这些是长期经验和偏好，不是本局事实或必做清单。按相关性参考即可；本轮明确要求与当前阵容优先。常用位置、英雄不限定本局角色或候选。\n';
    const result = selected.length ? header + selected.map(item => item.line).join('\n') : '';
    return { text: result, entries: selected.map(({ id, title }) => ({ id, title })), characters: result.length };
  }
  return Object.freeze({ select });
})();
