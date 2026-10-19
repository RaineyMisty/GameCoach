'use strict';

window.GameCoachSkill = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  // 入口只串联流程；具体资料整理和输出处理分别位于 input/、output/。
  const prepare = (input, context) => window.GameCoachSkillInput.prepare(input, context);

  async function run(input, { context, onDelta, ...execution } = {}) {
    const requestInput = structuredClone(input);
    const webSearch = window.GameCoachSkillKnowledge.wantsSearch(requestInput, context?.searchMode || 'auto');
    const requestContext = { ...structuredClone(context), webSearch };
    requestContext.draft ??= Array.isArray(requestInput) ? requestInput.at(-1)?.draft : undefined;
    const prepared = prepare(requestInput, requestContext);
    const output = window.GameCoachSkillOutput.create(onDelta);
    // Quick / Coach、超时、取消等由 ai-core 执行，不混入玩家文字。
    const response = await window.GameCoachAI.call(prepared, { ...execution, webSearch, onDelta: output.stream });
    const sources = window.GameCoachSkillKnowledge.collect(
      typeof requestInput === 'string' ? [{ role: 'user', content: requestInput }] : requestInput, requestContext).sources;
    const memory = window.GameCoachMemoryRetrieval.select(requestContext.memory, requestInput, requestContext);
    return output.finish({ ...response, sources: [...sources, ...(response.sources || [])], usedMemories: memory.entries });
  }
  // prepare 是纯函数入口，可单独查看发给 ai-core 的消息，不会联网或保存数据。
  return Object.freeze({ prepare, run });
})();
