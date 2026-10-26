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
  function apiError(status, upstream = {}) {
    // Only known diagnostic codes are displayed. Never echo upstream messages,
    // metadata, URLs or arbitrary reason strings: they can contain credentials.
    const reasons = {
      API_KEY_INVALID: tr("Google 明确返回密钥无效，请重新复制完整 Key 或创建新 Key。"),
      API_KEY_EXPIRED: tr("Google 明确返回密钥已过期，请创建新 Key。"),
      API_KEY_HTTP_REFERRER_BLOCKED: tr("密钥的网站来源限制拒绝了请求，请核对允许的网站和请求的 Referer。"),
      API_KEY_IP_ADDRESS_BLOCKED: tr("密钥的 IP 限制拒绝了请求；切换 Wi-Fi 或热点后出口 IP 可能改变。"),
      API_KEY_SERVICE_BLOCKED: tr("密钥未获准调用此 API，请检查 API 限制。"),
      SERVICE_DISABLED: tr("项目未启用此 API，请检查项目的 API 服务设置。"),
      BILLING_DISABLED: tr("项目计费未启用或不可用，请检查项目计费与模型要求。"),
      CONSUMER_INVALID: tr("请求关联的项目无效，请检查密钥所属项目。"),
      ACCESS_TOKEN_EXPIRED: tr("Google 返回认证令牌已过期，请检查凭证类型。"),
    };
    const details = Array.isArray(upstream?.details) ? upstream.details : [];
    const reason = details.map(item => item?.reason).find(value => Object.hasOwn(reasons, value)) || '';
    const statuses = ['INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND',
      'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'];
    const rpcStatus = statuses.includes(upstream?.status) ? upstream.status : '';
    const messages = {
      400: tr("请求参数不被接受，请检查模型、思考参数和凭证；尚不能确定是密钥问题。"),
      401: tr("身份验证失败；Google 未明确说明密钥无效或过期，请检查凭证与认证设置。"),
      403: tr("访问被拒绝，请检查密钥的网站/IP/API 限制、项目权限及地区支持；不代表密钥已过期。"),
      404: tr("模型或接口不存在，或当前项目无法访问，请检查模型配置。"),
      408: tr("Google 接收请求超时，请稍后重试。"),
      413: tr("本次上下文过长，请开始新对话或缩短输入。"),
      429: tr("请求频率或项目额度达到限制，请检查 AI Studio 配额和计费状态。"),
      500: tr("Google 服务内部错误，请稍后重试。"),
      502: tr("Google 网关错误，请稍后重试。"),
      503: tr("Google 服务暂时不可用，请稍后重试。"),
      504: tr("Google 服务处理超时，请稍后重试。"),
    };
    const diagnostic = ['HTTP ' + status, rpcStatus, reason].filter(Boolean).join(' / ');
    const error = new Error((reasons[reason] || messages[status] || tr("Google 拒绝了请求，未提供可安全展示的具体原因。")) + ' [' + diagnostic + ']');
    error.name = 'GeminiError'; error.status = status;
    error.reason = reason; error.rpcStatus = rpcStatus;
    error.retryable = [408, 429, 500, 502, 503, 504].includes(status) && !reason;
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
        const error = apiError(response.status, data?.error);
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
      const failure = new Error(tr("浏览器未取得可读取的 HTTP 响应，无法判断密钥是否有效。可能是网络/DNS/TLS、跨域或浏览器拦截；请查看开发者工具的 Network/Console。") + " [NO_HTTP_RESPONSE]");
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
      if (event.error) throw apiError(Number.isInteger(event.error.code) && event.error.code >= 400 && event.error.code <= 599 ? event.error.code : 500, event.error);
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
