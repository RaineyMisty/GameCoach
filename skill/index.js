'use strict';

// 页面兼容入口：只选择模块并转发调用，不放模式策略或网络实现。
window.GameCoachSkill = (() => {
  const quick = window.GameCoachSkillQuick;
  const coach = window.GameCoachSkillCoach;
  function pathFor(mode = 'quick') {
    if (mode === 'quick') return quick;
    if (mode === 'coach') return coach;
    const message = window.GameCoachI18n ? window.GameCoachI18n.t('未知的执行模式。') : '未知的执行模式。';
    throw new TypeError(message);
  }
  const prepare = (input, context, { mode = 'quick' } = {}) => pathFor(mode).prepare(input, context);
  const run = (input, options = {}) => pathFor(options.mode).run(input, options);

  // 兼容原有调试和测试接口；共用工具本身不反向依赖路由。
  window.GameCoachSkillInput = Object.freeze({ ...window.GameCoachSkillInput,
    prepare,
    build: (input, context, { mode = 'quick' } = {}) => pathFor(mode).build(input, context),
  });
  return Object.freeze({ prepare, run, quick, coach, pathFor });
})();
