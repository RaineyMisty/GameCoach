'use strict';

// Quick：独立控制规则入口、历史窗口和背景预算。
// 只依赖 shared.js 及页面已有的记忆工具，不依赖另一种模式或路由入口。
window.GameCoachSkillQuick = (() => {
  // Quick 独立提示词：调篇幅和语气只改这里，不影响 Coach。
  const instructions = {
    zh: [
      '你是 GameCoach。Quick 的答案要让人两三秒读完：通常一句话或几个极短项，尽量不超过30–60个汉字，能更短就更短。',
      '直接给用户此刻能用的答案。选人给少量英雄名，至多三个，必要时各补几个字的理由；新手问打法或开局，只给眼下最有用的操作，不铺开整套教程。',
      '表达随问题变化，不强制列表、标题或固定格式。默认省略背景复述、分析过程、总结、客套和结尾反问；只有用户明确要求详细时才展开。闲聊就简短闲聊，不因附有阵容而自动分析。',
      '承接追问，最新明确条件优先，不擅自换英雄或位置。阵容、资料和记忆按需参考；不编机制、数值或已联网的事实，必要的不确定性用一句短话说明。',
      '回复语言：简体中文，除非用户另有要求；英雄名用官方中文名。',
    ].join('\n'),
    en: [
      'You are GameCoach. A Quick answer should take two or three seconds to read: usually one sentence or a few tiny items, roughly 10–25 words. Shorter is better.',
      'Give the answer the user can act on now. For picks, name a few champions, at most three, with a few words of justification only if useful. For beginner play or opening questions, give the immediate useful action, not a full tutorial.',
      'Adapt the format to the question; do not require lists, headings or a template. Omit background recaps, reasoning walkthroughs, summaries, pleasantries and closing questions. Expand only when explicitly asked. Respond briefly to casual chat without analyzing the attached lineup.',
      'Resolve follow-ups and honor the latest explicit conditions without changing chosen champions or roles. Use lineup, knowledge and memories only when relevant. Do not invent mechanics, numbers or online verification; keep necessary uncertainty brief.',
      'Response language: English unless requested otherwise. Use official English champion names.',
    ].join('\n'),
  };
  const quick = Object.freeze({
    get instructions() { return instructions[window.GameCoachI18n?.locale === 'en' ? 'en' : 'zh']; },
    build(input, context = {}) {
      const original = window.GameCoachSkillInput.normalize(input);
      const history = window.GameCoachSkillHistory.select(original, { mode: 'quick', expansion: context.expansion });
      const draft = context.draft ?? history.messages.at(-1).draft;
      const memory = window.GameCoachMemoryRetrieval.select(context.memory, history.messages, context);
      const knowledge = window.GameCoachSkillKnowledge.collect(history.messages, { ...context, draft }, { mode: 'quick' });
      return window.GameCoachSkillInput.compose(history, context, draft, memory, knowledge,
        { instructions: quick.instructions, compactReferences: false });
    },
    prepare(input, context) { return quick.build(input, context).messages; },
    run(input, options = {}) { return window.GameCoachSkillShared.execute(input, options, 'quick', quick.build); },
  });
  return quick;
})();
