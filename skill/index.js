'use strict';

window.GameCoachSkill = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  // 入口只串联流程；具体资料整理和输出处理分别位于 input/、output/。
  const prepare = (input, context, options) => window.GameCoachSkillInput.prepare(input, context, options);

  async function run(input, { context, onDelta, ...execution } = {}) {
    const requestInput = structuredClone(input);
    const backend = window.GameCoachAI.getProviderName() === 'backend';
    const webSearch = !backend && window.GameCoachSkillKnowledge.wantsSearch(requestInput, context?.searchMode || 'auto');
    const requestContext = { ...structuredClone(context), webSearch };
    if (backend) requestContext.memory = undefined; // Server retrieves the shared user's training memory.
    requestContext.draft ??= Array.isArray(requestInput) ? requestInput.at(-1)?.draft : undefined;
    // The backend reads history from SQLite. Send only this turn's Skill context.
    const turn = backend && Array.isArray(requestInput) ? [requestInput.at(-1)] : requestInput;
    const prepared = window.GameCoachSkillInput.build(turn, requestContext, { mode: execution.mode || 'quick' });
    const output = window.GameCoachSkillOutput.create(onDelta);
    // Quick / Coach、超时、取消等由 ai-core 执行，不混入玩家文字。
    const response = await window.GameCoachAI.call(prepared.messages, { ...execution, webSearch, onDelta: output.stream });
    return output.finish({ ...response, sources: [...prepared.sources, ...(response.sources || [])],
      usedMemories: backend ? (response.usedMemories || []) : prepared.usedMemories });
  }
  // prepare 是纯函数入口，可单独查看发给 ai-core 的消息，不会联网或保存数据。
  return Object.freeze({ prepare, run });
})();
