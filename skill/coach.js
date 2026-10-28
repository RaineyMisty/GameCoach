'use strict';

// Coach：独立控制规则入口、历史窗口和背景预算。
// 只依赖 shared.js 及页面已有的记忆工具，不依赖另一种模式或路由入口。
window.GameCoachSkillCoach = (() => {
  const coach = Object.freeze({
    get instructions() { return window.GameCoachSkillRules.instructions; },
    build(input, context = {}) {
      const original = window.GameCoachSkillInput.normalize(input);
      const history = window.GameCoachSkillHistory.select(original, { mode: 'coach', expansion: context.expansion });
      const draft = context.draft ?? history.messages.at(-1).draft;
      const memory = window.GameCoachMemoryRetrieval.select(context.memory, history.messages,
        { ...context, maxEntries: 3, maxCharacters: 600 });
      const knowledge = window.GameCoachSkillKnowledge.collect(history.messages, { ...context, draft }, { mode: 'coach' });
      return window.GameCoachSkillInput.compose(history, context, draft, memory, knowledge,
        { instructions: coach.instructions, compactReferences: true });
    },
    prepare(input, context) { return coach.build(input, context).messages; },
    run(input, options = {}) { return window.GameCoachSkillShared.execute(input, options, 'coach', coach.build); },
  });
  return coach;
})();
