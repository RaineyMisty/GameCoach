'use strict';

// Generic model-call layer: no DOM, storage, game data, or Skill instructions.
// Classic scripts keep the app usable by double-clicking index.html.
window.GameCoachAI = (() => {
  const profiles = {
    quick: { model: 'demo-instant', reasoningEffort: 'none', maxOutputTokens: 128, timeoutMs: 5000 },
    coach: { model: 'demo-reasoning', reasoningEffort: 'medium', maxOutputTokens: 1024, timeoutMs: 30000 },
  };
  const abortError = () => new DOMException('请求已停止。', 'AbortError');
  const providers = new Map();
  let selectedProvider = 'demo';
  const now = () => performance.now();

  providers.set('demo', {
    isDemo: true,
    async generate({ input, model, signal, onDelta }) {
      const last = typeof input === 'string' ? input : [...input].reverse().find(item => item.role === 'user')?.content;
      const text = typeof last === 'string' ? last : (Array.isArray(last) ? last.filter(part => part.type === 'text' || part.type === 'input_text').map(part => part.text || '').join(' ') : '你的输入');
      const excerpt = text.slice(0, 60);
      const content = model === 'demo-instant'
        ? `演示：收到“${excerpt}”。真实 AI 尚未接入。`
        : `演示：收到“${excerpt}”。\n\n你可以继续补充信息或追问，同一对话会保留历史。这是占位回复，尚未接入真实 AI。`;
      // No artificial thinking delay. A real provider forwards its text deltas here.
      const characters = Array.from(content);
      for (let i = 0; i < characters.length; i += 8) {
        if (signal.aborted) throw abortError();
        onDelta(characters.slice(i, i + 8).join(''));
        await Promise.resolve();
      }
      return { content };
    },
  });

  function registerProvider(name, implementation) {
    if (typeof name !== 'string' || !name.trim() || typeof implementation?.generate !== 'function') throw new TypeError('Provider 必须提供 generate(request)。');
    providers.set(name, implementation);
  }
  function configure({ provider = selectedProvider, modes = {} } = {}) {
    if (!providers.has(provider)) throw new Error('未知的 AI provider。');
    const next = {};
    for (const [mode, patch] of Object.entries(modes)) {
      if (!Object.hasOwn(profiles, mode)) throw new Error('未知的执行模式。');
      const value = { ...profiles[mode], ...patch };
      if (typeof value.model !== 'string' || !value.model.trim() ||
          (value.instructions !== undefined && typeof value.instructions !== 'string') ||
          !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.reasoningEffort) ||
          !Number.isInteger(value.maxOutputTokens) || value.maxOutputTokens < 1 ||
          !Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0) throw new TypeError('无效的执行配置。');
      next[mode] = value;
    }
    Object.assign(profiles, next);
    selectedProvider = provider;
  }
  function getProfile(mode) {
    if (!Object.hasOwn(profiles, mode)) throw new Error('未知的执行模式。');
    return { ...profiles[mode] };
  }
  async function call(input, { mode = 'quick', signal, onDelta = () => {} } = {}) {
    if (!(typeof input === 'string' && input.trim()) && !(Array.isArray(input) && input.length)) throw new TypeError('请输入文本或消息列表。');
    if (typeof onDelta !== 'function') throw new TypeError('onDelta 必须是函数。');
    if (signal?.aborted) throw abortError();
    // Snapshot settings and input: changing modes must not mutate an in-flight call.
    const settings = getProfile(mode);
    const providerName = selectedProvider;
    const provider = providers.get(providerName);
    const requestInput = structuredClone(input);
    const controller = new AbortController();
    const started = now();
    let firstDeltaMs = null;
    let streamed = '';
    let settled = false;
    let rejectStop;
    const stop = new Promise((_, reject) => { rejectStop = reject; });
    const cancel = () => { controller.abort(); rejectStop(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      const error = new Error('响应超时，请重试。'); error.name = 'TimeoutError'; rejectStop(error);
      controller.abort();
    }, settings.timeoutMs);
    const emit = delta => {
      if (settled || controller.signal.aborted) return;
      if (typeof delta !== 'string') throw new TypeError('Provider 返回了无效的文本片段。');
      if (!delta) return;
      if (firstDeltaMs === null) firstDeltaMs = now() - started;
      streamed += delta;
      onDelta(delta);
    };
    try {
      const output = await Promise.race([
        Promise.resolve().then(() => provider.generate({ input: requestInput, ...settings, signal: controller.signal, onDelta: emit })),
        stop,
      ]);
      const content = typeof output === 'string' ? output : output?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('AI 返回了空回复。');
      if (streamed && streamed !== content) throw new Error('Provider 的流式内容与最终回复不一致。');
      if (!streamed) emit(content);
      return { content, mode, provider: providerName, model: settings.model,
        isDemo: provider.isDemo === true, reasoningEffort: settings.reasoningEffort,
        finishReason: typeof output?.finishReason === 'string' ? output.finishReason : undefined,
        timings: { firstDeltaMs, totalMs: now() - started } };
    } finally {
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort();
    }
  }
  return Object.freeze({ call, configure, getProfile, registerProvider, getProviderName: () => selectedProvider });
})();
