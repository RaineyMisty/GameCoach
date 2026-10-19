'use strict';

window.GameCoachSkillInput = (() => {
  // 这段是固定职责说明。玩家偏好与阵容作为 user 级资料传递，不提升为系统指令。

  function prepare(input, context = {}) {
    if (!(typeof input === 'string' && input.trim()) && !(Array.isArray(input) && input.length)) {
      throw new TypeError('请输入文本或消息列表。');
    }
    const messages = structuredClone(typeof input === 'string' ? [{ role: 'user', content: input }] : input);
    if (messages.some(message => !message || !['system', 'developer', 'user', 'assistant'].includes(message.role))) {
      throw new TypeError('消息角色必须是 system、developer、user 或 assistant。');
    }
    if (messages.at(-1).role !== 'user') throw new TypeError('请在消息列表末尾添加用户问题。');
    const currentDraft = context?.draft ?? messages.at(-1).draft;
    const current = window.GameCoachSkillGame.describe(currentDraft);
    const memory = window.GameCoachMemoryRetrieval.select(context?.memory, messages, context || {});

    // 相同阵容只展开一次，其余消息用短标签引用；变化后的旧阵容仍能被追问。
    const snapshots = new Map(); let historyNumber = 0;
    if (current) snapshots.set(current, '当前');
    const references = messages.map((message, index) => {
      if (message.role !== 'user') return null;
      const text = index === messages.length - 1 ? current : window.GameCoachSkillGame.describe(message.draft);
      if (!text) return null;
      if (!snapshots.has(text)) snapshots.set(text, '历史' + (++historyNumber));
      return snapshots.get(text);
    });
    const facts = [...snapshots].map(([text, name]) => '【' + name + '阵容】\n' + text);
    if (memory.text) facts.push(memory.text);

    const knowledge = window.GameCoachSkillKnowledge.collect(messages, { ...context, draft: currentDraft });
    if (knowledge.text) facts.push(knowledge.text);
    if (context?.declarations?.length) facts.push('【用户曾明确说过；可能有后续更正，以本轮为准】\n'
      + context.declarations.slice(-3).map(value => JSON.stringify(String(value))).join('\n'));
    if (context?.lastCall) facts.push('【应用状态】上一请求'
      + (context.lastCall.status === 'cancelled' ? '被停止' : '未能完成')
      + (context.lastCall.partial ? '，只有部分文字，不能当作完整回答。' : '，没有完整回答。') + '用户可能在询问连接是否恢复。');
    const anchorInHistory = !!context?.expansion?.replyId && messages.some(message => message.id === context.expansion.replyId);
    if (context?.expansion) facts.push('【本次深入解释的引用对象】\n原问题：' + JSON.stringify(context.expansion.question)
      + (anchorInHistory ? '\n被点击的回答在历史中标为【深入解释目标】。' : '\n被点击的回答：' + JSON.stringify(context.expansion.answer))
      + '\n只展开这个回答中的相关观点；若原回答有误先纠正，不重新生成整份阵容报告。');
    facts.push(context?.webSearch ? '【检索能力】本次允许 Google Search；只有实际查到资料才称已核实。'
      : '【检索能力】本次未启用联网；可用所附资料快照，不将其称为实时版本。');
    const prepared = [{ role: 'system', content: window.GameCoachSkillRules.instructions }];
    let previousReference;
    for (const [index, message] of messages.entries()) {
      if (anchorInHistory && message.id === context.expansion.replyId) prepared.push({ role: 'user', content: '【深入解释目标】下面这条回答是用户点击的对象。' });
      // 当前资料放在最近的问题旁边，减少长历史中旧回答对事实的干扰。
      if (index === messages.length - 1 && facts.length) {
        prepared.push({ role: 'user', content: '【可选背景：仅在与本轮问题有关时使用】\n' + facts.join('\n\n') });
      }
      if (message.role === 'user' && snapshots.size) {
        const reference = references[index];
        if (reference !== previousReference || index === messages.length - 1) {
          prepared.push({ role: 'user', content: reference ? '【本条阵容：' + reference + '】' : '【本条阵容未记录】' });
        }
        previousReference = reference;
      }
      // 正文及多模态片段保留原文；本地 draft 等元数据不会交给 ai-core。
      prepared.push({ role: message.role, content: message.content });
    }
    return prepared;
  }
  return Object.freeze({ prepare });
})();
