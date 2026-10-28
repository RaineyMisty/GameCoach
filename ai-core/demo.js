'use strict';

// 未连接 AI 时的独立界面演示。没有联网、游戏分析或真实 Skill 规则。
(() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  const abortError = () => new DOMException(tr('请求已停止。'), 'AbortError');
  window.GameCoachDemo = {
    isDemo: true,
    async generate({ input, model, signal, onDelta }) {
      const last = typeof input === 'string' ? input : [...input].reverse().find(item => item.role === 'user')?.content;
      const text = typeof last === 'string' ? last : (Array.isArray(last) ? last.filter(part => part.type === 'text' || part.type === 'input_text').map(part => part.text || '').join(' ') : tr("你的输入"));
      const excerpt = text.slice(0, 60);
      const content = model === 'demo-instant'
        ? tr("演示：收到“{0}”。真实 AI 尚未接入。", excerpt)
        : tr("演示：收到“{0}”。\n\n你可以继续补充信息或追问，同一对话会保留历史。这是占位回复，尚未接入真实 AI。", excerpt);
      // No artificial thinking delay. A real provider forwards its text deltas here.
      const characters = Array.from(content);
      for (let i = 0; i < characters.length; i += 8) {
        if (signal.aborted) throw abortError();
        onDelta(characters.slice(i, i + 8).join(''));
        await Promise.resolve();
      }
      return { content };
    },
  };
})();
