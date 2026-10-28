'use strict';

// Quick：独立控制规则入口、历史窗口和背景预算。
// 只依赖 shared.js 及页面已有的记忆工具，不依赖另一种模式或路由入口。
window.GameCoachSkillQuick = (() => {
  const quick = Object.freeze({
    get instructions() { return window.GameCoachSkillRules.instructions; },
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
