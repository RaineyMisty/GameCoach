'use strict';

// User-owned credentials stay in this page's memory; never persist or export them.
window.GameCoachGemini = (() => {
  const tr = (...args) => window.GameCoachI18n ? window.GameCoachI18n.t(...args) : args[0].replace(/\{(\d+)\}/g, (_, i) => args[Number(i) + 1]);
  const origin = 'https://generativelanguage.googleapis.com/v1beta';
  const models = Object.freeze({ quick: 'gemini-3.5-flash-lite', coach: 'gemini-3.8-flash' });
  const modeInstructions = Object.freeze({
    quick: '当前是 Quick/快速建议回答档位，不是游戏玩法。自然简短地回应本轮问题，闲聊就正常聊天，分析时先说最有用的建议，通常几句话即可。不固定打印“结论：”“理由：”等栏目，不重复背景，不输出内部思考过程。',
    coach: 'Coach：只展开本轮问题，默认两三段；用户要求时再全面深入，不展示内部思考。',
  });
  const demoProfiles = { quick: window.GameCoachAI.getProfile('quick'), coach: window.GameCoachAI.getProfile('coach') };
  let apiKey = '';
  const aborted = () => new DOMException(tr("请求已停止。"), 'AbortError');
  function apiError(status, code) {
    const messages = {
      400: tr("Gemini 拒绝了请求，请检查 API Key、模型参数，以及项目是否可以使用免费档。"),
      401: tr("Gemini API Key 无效或已失效，请重新填写。"),
      403: tr("Gemini 拒绝访问，请检查密钥限制、项目权限或所在地区是否受支持。"),
      404: tr("Gemini 模型不可用，请检查当前账号的模型权限和模型配置。"),
      413: tr("本次上下文过长，请开始新对话或缩短输入。"),
      429: tr("Gemini 请求过于频繁或当前项目额度不足，请在 AI Studio 查看限额后重试。"),
    };
    const error = new Error(code === 'API_KEY_INVALID' || code === 'API_KEY_EXPIRED'
      ? tr("Gemini API Key 无效或已失效，请从 Google AI Studio 重新复制密钥。")
      : messages[status] || tr("Gemini 服务暂时不可用（HTTP {0}），请稍后再试。", status));
    // Never display raw upstream messages: they can echo credentials or input.
    error.name = 'GeminiError'; error.status = status;
    error.retryable = [408, 429, 500, 502, 503, 504].includes(status) && !['API_KEY_INVALID', 'API_KEY_EXPIRED'].includes(code);
    return error;
  }
  async function request(path, options, secret) {
    try {
      const response = await fetch(origin + path, {
        ...options, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
        headers: { 'x-goog-api-key': secret, ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      });
      if (!response.ok) {
        let data;
        try { data = await response.json(); } catch {}
        const code = data?.error?.details?.find(item => typeof item.reason === 'string')?.reason;
        const error = apiError(response.status, code);
        const retry = response.headers.get('retry-after');
        if (retry) {
          const delay = /^\d{1,6}$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
          if (Number.isFinite(delay) && delay > 0) error.retryAfterMs = delay;
        }
        if (response.status === 429 && retry && /^\d{1,6}$/.test(retry)) error.message += tr(" 建议至少等待 {0} 秒。", retry);
        throw error;
      }
      return response;
    } catch (error) {
      if (options.signal?.aborted) throw aborted();
      if (error.name === 'GeminiError') throw error;
      const failure = new Error(tr("无法连接 Gemini。请检查网络连接；如果浏览器阻止本地文件请求，请改用本地网页服务或 GitHub Pages 的 HTTPS 页面。"));
      failure.retryable = true; throw failure;
    }
  }
  function parts(content) {
    if (typeof content === 'string' && content.trim()) return [{ text: content }];
    if (!Array.isArray(content) || !content.length) throw new Error(tr("消息内容必须是文字或内容片段列表。"));
    return content.map(part => {
      if (!part || typeof part !== 'object') throw new Error(tr("消息包含无效内容片段。"));
      if (typeof part.text === 'string' && (!part.type || ['text', 'input_text'].includes(part.type))) return { text: part.text };
      if (part.inlineData && typeof part.inlineData.mimeType === 'string' && typeof part.inlineData.data === 'string') return { inlineData: structuredClone(part.inlineData) };
      if (part.fileData && typeof part.fileData.mimeType === 'string' && typeof part.fileData.fileUri === 'string') return { fileData: structuredClone(part.fileData) };
      if (part.type === 'image_url') {
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(part.image_url?.url || '');
        if (match) return { inlineData: { mimeType: match[1], data: match[2].replace(/[\r\n]/g, '') } };
      }
      throw new Error(tr("不支持此内容片段。图片可使用 base64 数据，或 Gemini 的 inlineData / fileData；页面目前提供文字输入。"));
    });
  }
  function normalize(input, instructions) {
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
    if (!Array.isArray(messages) || !messages.length) throw new Error(tr("请输入文本或消息列表。"));
    const contents = []; const system = instructions ? [{ text: instructions }] : [];
    for (const message of messages) {
      if (!message || !['system', 'developer', 'user', 'assistant'].includes(message.role)) throw new Error(tr("消息角色必须是 system、developer、user 或 assistant。"));
      const value = parts(message.content);
      if (message.role === 'system' || message.role === 'developer') {
        if (value.some(part => typeof part.text !== 'string')) throw new Error(tr("系统补充信息只能使用文字。"));
        system.push(...value); continue;
      }
      const role = message.role === 'assistant' ? 'model' : 'user';
      if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...value);
      else contents.push({ role, parts: value });
    }
    if (!contents.length || contents.at(-1).role !== 'user') throw new Error(tr("请在消息列表末尾添加用户问题。"));
    return { contents, ...(system.length ? { systemInstruction: { parts: system } } : {}) };
  }
  async function generate({ input, model, reasoningEffort, maxOutputTokens, instructions, signal, onDelta, webSearch }) {
    const secret = apiKey;
    if (!secret) throw new Error(tr("请先打开“AI 连接”，填写 Gemini API Key 并启用。"));
    const supported = model === models.quick ? ['minimal', 'low', 'medium', 'high'] : model === models.coach ? ['low', 'medium', 'high'] : [];
    if (!supported.includes(reasoningEffort)) throw new Error(tr("当前 Gemini 模型或思考档位不受支持，请检查 ai-core/gemini.js 配置。"));
    if (signal.aborted) throw aborted();
    const response = await request(`/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST', signal,
      body: JSON.stringify({ ...normalize(input, (() => {
        const key = model === models.coach ? modeInstructions.coach : model === models.quick ? modeInstructions.quick : null;
        // An activated key can survive a language switch. Resolve built-in copy
        // for this request; preserve custom instructions configured by callers.
        return key && (instructions === key || instructions === window.GAMECOACH_ENGLISH?.[key]) ? tr(key) : instructions;
      })()), generationConfig: {
        maxOutputTokens, thinkingConfig: { thinkingLevel: reasoningEffort.toUpperCase(), includeThoughts: false },
      }, ...(webSearch ? { tools: [{ googleSearch: {} }] } : {}) }),
    }, secret);
    let content = ''; let finishReason; let finished = false;
    const sources = new Map(); let searchSuggestions = ''; let searched = false; let usage;
    function metadata(event, candidate) {
      const data = candidate?.groundingMetadata;
      if (data) {
        if (data.webSearchQueries?.length || data.groundingChunks?.length) searched = true;
        if (typeof data.searchEntryPoint?.renderedContent === 'string') searchSuggestions = data.searchEntryPoint.renderedContent.slice(0, 30000);
        for (const chunk of data.groundingChunks || []) {
          try { const url = new URL(chunk.web?.uri); if (!['https:', 'http:'].includes(url.protocol)) continue;
            sources.set(url.href, { url: url.href, title: String(chunk.web.title || url.hostname).slice(0, 160), kind: 'web' });
          } catch {}
        }
      }
      if (event.usageMetadata) usage = {
        inputTokens: event.usageMetadata.promptTokenCount,
        outputTokens: event.usageMetadata.candidatesTokenCount,
        totalTokens: event.usageMetadata.totalTokenCount,
      };
    }
    function accept(event) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error(tr("Gemini 回复格式异常，请重试。"));
      if (event.error) throw apiError(Number(event.error.code) || 500);
      if (event.promptFeedback?.blockReason) throw new Error(tr("Gemini 拦截了本次输入，请调整问题后重试。"));
      const candidate = event.candidates?.find(item => item.index === 0 || item.index === undefined);
      metadata(event, candidate);
      if (!candidate) return;
      const reason = candidate.finishReason;
      if (reason && !['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED'].includes(reason)) throw new Error(tr("Gemini 未完成回答，可能受到内容限制或生成异常影响，请调整问题后重试。"));
      for (const part of candidate.content?.parts || []) {
        if (part.thought || typeof part.text !== 'string' || !part.text) continue;
        content += part.text; onDelta(part.text);
      }
      if (reason === 'STOP' || reason === 'MAX_TOKENS') { finishReason = reason === 'MAX_TOKENS' ? 'length' : 'stop'; finished = true; }
    }
    function result() {
      if (signal.aborted) throw aborted();
      if (!finished || !content.trim()) {
        const error = new Error(!finished ? tr("连接中断，回复未完整接收，请重试。") : finishReason === 'length'
          ? tr("本次思考已用完生成额度但未产生答案，请缩短问题或使用 Quick。") : tr("Gemini 没有返回可显示的答案。"));
        error.retryable = !content; throw error;
      }
      return { content, finishReason, sources: [...sources.values()], searchSuggestions, searched, usage };
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      let data;
      try { data = await response.json(); } catch { throw new Error(tr("Gemini 返回了无法解析的回复。")); }
      accept(data); return result();
    }
    if (!response.body) { const error = new Error(tr("Gemini 没有返回回复流。")); error.retryable = true; throw error; }
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let buffer = ''; let fields = [];
    function dispatch() {
      if (!fields.length || finished) { fields = []; return; }
      const value = fields.join('\n'); fields = [];
      // Gemini ends a response with candidate.finishReason, not OpenAI's [DONE].
      if (value.trim() === '[DONE]') throw new Error(tr("Gemini 回复缺少正常结束状态，请重试。"));
      let event;
      try { event = JSON.parse(value); } catch { throw new Error(tr("Gemini 回复流格式异常，请重试。")); }
      accept(event);
    }
    function consume(final = false) {
      let match;
      while (!finished && (match = /\r\n|\r|\n/.exec(buffer))) {
        if (!final && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        if (!line) dispatch();
        else if (line.startsWith('data:')) fields.push(line.slice(5).replace(/^ /, ''));
      }
      if (buffer.length + fields.reduce((length, field) => length + field.length, 0) > 1048576) throw new Error(tr("Gemini 回复流格式异常，单个片段过大。"));
      if (final && !finished) {
        if (buffer.startsWith('data:')) fields.push(buffer.slice(5).replace(/^ /, ''));
        buffer = ''; dispatch();
      }
    }
    try {
      while (!finished) {
        if (signal.aborted) throw aborted();
        const { done, value } = await reader.read();
        if (done) { buffer += decoder.decode(); consume(true); break; }
        buffer += decoder.decode(value, { stream: true }); consume();
      }
      return result();
    } catch (error) {
      if (signal.aborted) throw aborted();
      if (error instanceof TypeError) { const failure = new Error(tr("接收 Gemini 回复时连接中断，请检查网络后重试。")); failure.retryable = true; throw failure; }
      throw error;
    } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
  }
  window.GameCoachAI.registerProvider('gemini', { isDemo: false, generate });
  function activate(key) {
    const clean = typeof key === 'string' ? key.trim() : '';
    // Google now issues opaque AQ. auth keys as well as legacy AIza keys.
    // Validate safe header input, not a vendor token alphabet or fixed prefix.
    if (!/^[\x21-\x7E]{16,8192}$/.test(clean) || /["'`]/.test(clean)) throw new Error(tr("密钥格式检查未通过：请复制完整 Key（支持 AIza… / AQ.…），不要带引号、内部空格、换行或 Bearer 前缀。"));
    window.GameCoachAI.configure({ provider: 'gemini', modes: {
      quick: { model: models.quick, reasoningEffort: 'minimal', maxOutputTokens: 512, timeoutMs: 10000,
        instructions: tr(modeInstructions.quick) },
      coach: { model: models.coach, reasoningEffort: 'medium', maxOutputTokens: 4096, timeoutMs: 60000,
        instructions: tr(modeInstructions.coach) },
    } });
    apiKey = clean;
  }
  function disconnect() {
    apiKey = '';
    window.GameCoachAI.configure({ provider: 'demo', modes: {
      quick: { ...demoProfiles.quick, instructions: '' }, coach: { ...demoProfiles.coach, instructions: '' },
    } });
  }
  async function testConnection() {
    const secret = apiKey;
    if (!secret) throw new Error(tr("请先填写密钥并启用 Gemini。"));
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      await Promise.all(Object.values(models).map(async model => {
        const response = await request('/models/' + model, { method: 'GET', signal: controller.signal }, secret);
        const data = await response.json();
        if (data.name !== 'models/' + model || !data.supportedGenerationMethods?.includes('generateContent')) throw new Error(tr("密钥可用，但当前 Gemini 模型未开放文字生成，请检查 AI Studio 项目权限。"));
      }));
      return { models: { ...models } };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(tr("连接测试超时，请检查网络后重试。"));
      throw error;
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return Object.freeze({ activate, disconnect, testConnection, isConfigured: () => !!apiKey, models });
})();
