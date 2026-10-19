'use strict';

// 纯对话逻辑，方便单独验证按钮引用、失败状态和历史；不读取页面或存储。
window.GameCoachConversation = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  function buildHistory(messages, limit = 20) {
    const history = messages.filter(message => !message.localOnly && (message.role === 'user' ||
      (message.role === 'coach' && (!message.status || message.status === 'complete') && message.isDemo !== true))).slice(-limit);
    while (history[0]?.role !== 'user' && history.length) history.shift();
    return history.map(message => ({ role: message.role === 'coach' ? 'assistant' : 'user', content: message.content, id: message.id,
      ...(message.role === 'user' ? { draft: structuredClone(message.draft) } : {}) }));
  }
  function lastCall(messages) {
    const reply = messages.at(-1);
    if (reply?.role !== 'coach' || !['error', 'cancelled', 'pending'].includes(reply.status)) return null;
    return { status: reply.status, partial: !!reply.content && !/^生成失败：|^已停止生成/.test(reply.content) };
  }
  function declarations(messages) {
    // 仅摘录用户自己的明确声明，不把模型的推断总结成“用户事实”。新更正优先。
    return [...new Set(messages.filter(message => !message.localOnly && message.role === 'user' &&
      /我(?:是|玩|用|选|走|打|就是|这把|偏要)|不换|就这样打|(?:改成|改一下|不是|我现在).*?(?:上单|打野|中单|射手|辅助|下路|吃兵)|固定.*(?:位置|下路|辅助)|\bI(?:'m| am| play| picked| pick| jungle| support| want to play)|\b(?:playing|going) (?:top|mid|bot|support|jungle)|do not (?:change|swap)/i.test(message.content))
      .slice(-3).map(message => message.content.slice(0, 240)))];
  }
  function expansion(messages, replyId) {
    const index = messages.findIndex(message => (typeof replyId === 'object' ? message === replyId : !!replyId && message.id === replyId) && message.role === 'coach');
    const reply = messages[index];
    if (!reply || (reply.status && reply.status !== 'complete')) throw new Error(tr("这条回复尚未完成，无法展开。"));
    let question;
    for (let at = index - 1; at >= 0; at--) if (messages[at].role === 'user') { question = messages[at]; break; }
    if (!question) throw new Error(tr("没有找到这条回答对应的问题。"));
    return { replyId: reply.id, question: question.content, answer: reply.content,
      draft: structuredClone(question.draft || reply.draft) };
  }
  return Object.freeze({ buildHistory, lastCall, declarations, expansion });
})();
