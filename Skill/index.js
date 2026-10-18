'use strict';

// Placeholder Skill. Future enrichment and output formatting belong here.
// Execution options are forwarded separately, never injected into user text.
window.GameCoachSkill = (() => {
  const prepare = (input, context) => input;
  const format = response => response;

  async function run(input, { context, ...execution } = {}) {
    const prepared = prepare(input, context);
    const response = await window.GameCoachAI.call(prepared, execution);
    return format(response);
  }
  return Object.freeze({ run });
})();
