'use strict';

window.GameCoachSkillOutput = (() => {
  function create(onDelta = () => {}) {
    if (typeof onDelta !== 'function') throw new TypeError('onDelta 必须是函数。');
    // 每次请求独立创建处理器。当前逐片段透传，不缓冲、不再调用模型。
    function stream(delta) { onDelta(delta); }
    function finish(response) {
      // 后续扩展位置：规则评分 → 可选文字整理 → 实体资料关联。
      // 增加这些步骤时，要同时设计流式、取消和最终正文一致性。
      return response;
    }
    return Object.freeze({ stream, finish });
  }
  return Object.freeze({ create });
})();
