'use strict';

// Browser-only development adapter. The user's key exists only in this closure.
window.GameCoachGroq = (() => {
  const origin = 'https://api.groq.com/openai/v1';
  const model = 'qwen/qwen3.8-27b';
  const demoProfiles = { quick: window.GameCoachAI.getProfile('quick'), coach: window.GameCoachAI.getProfile('coach') };
  let apiKey = '';
  const aborted = () => new DOMException('请求已停止。', 'AbortError');
  function redact(value, secret) {
    let message = String(value || '');
    if (secret) message = message.split(secret).join('[密钥已隐藏]');
    return message.replace(/gsk_[A-Za-z0-9_-]+/g, '[密钥已隐藏]').slice(0, 400);
  }
  function requestError(status, details, secret) {
    const messages = {
      400: 'Groq 拒绝了请求，请检查模型和参数。',
      401: 'Groq API Key 无效或已失效，请重新填写。',
      403: 'Groq 拒绝访问，请检查账号、地区或模型权限。',
      404: 'Groq 模型不可用或已下线，请检查模型配置。',
      413: '本次上下文过长，请开始新对话或缩短输入。',
      429: 'Groq 请求过于频繁或已用完当前额度，请稍后再试。',
    };
    const error = new Error(messages[status] || `Groq 服务暂时不可用（HTTP ${status}），请稍后再试。`);
    error.name = 'GroqError'; error.status = status;
    if (status === 400 && details) error.message += ' ' + redact(details, secret);
    return error;
  }
  async function request(path, options, secret) {
    try {
      const response = await fetch(origin + path, {
        ...options, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
        headers: { Authorization: 'Bearer ' + secret, ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      });
      if (!response.ok) {
        let details;
        try { details = (await response.json())?.error?.message; } catch {}
        const error = requestError(response.status, details, secret);
        const retry = response.headers.get('retry-after');
        if (response.status === 429 && retry && /^\d+$/.test(retry)) error.message += ` 建议至少等待 ${retry} 秒。`;
        throw error;
      }
      return response;
    } catch (error) {
      if (options.signal?.aborted) throw aborted();
      if (error.name === 'GroqError') throw error;
      throw new Error('无法连接 Groq。请检查网络连接；如果浏览器阻止本地文件请求，请改用本地网页服务或 HTTPS 页面。');
    }
  }
  function normalize(input) {
    if (typeof input === 'string') return [{ role: 'user', content: input }];
    if (!Array.isArray(input) || !input.length) throw new Error('请输入文本或消息列表。');
    return input.map(message => {
      if (!message || !['system', 'developer', 'user', 'assistant'].includes(message.role)) throw new Error('当前 Groq 接口仅支持文字或图片对话消息。');
      return { role: message.role === 'developer' ? 'system' : message.role, content: structuredClone(message.content) };
    });
  }
  async function generate({ input, model, reasoningEffort, maxOutputTokens, instructions, signal, onDelta }) {
    const secret = apiKey;
    if (!secret) throw new Error('请先打开“AI 连接”，填写 Groq API Key 并启用。');
    if (!['none', 'low', 'medium', 'high'].includes(reasoningEffort)) throw new Error('当前 Qwen 配置支持 none、low、medium、high。');
    if (signal.aborted) throw aborted();
    const messages = normalize(input);
    if (instructions) messages.unshift({ role: 'system', content: instructions });
    const response = await request('/chat/completions', {
      method: 'POST', signal,
      body: JSON.stringify({ model, messages, reasoning_effort: reasoningEffort, reasoning_format: 'hidden',
        max_completion_tokens: maxOutputTokens, temperature: reasoningEffort === 'none' ? 0.7 : 1,
        stream: true }),
    }, secret);
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      let data;
      try { data = await response.json(); } catch { throw new Error('Groq 返回了无法解析的回复。'); }
      if (data.error) throw requestError(400, data.error.message, secret);
      const choice = data.choices?.[0];
      if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new Error(choice?.finish_reason === 'length' ? '本次生成额度已用尽但未产生答案，请缩短问题后重试。' : 'Groq 没有返回可显示的答案。');
      onDelta(choice.message.content);
      return { content: choice.message.content, finishReason: choice.finish_reason };
    }
    if (!response.body) throw new Error('Groq 没有返回回复流。');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ''; let fields = []; let content = ''; let finished = false; let finishReason;
    function dispatch() {
      if (!fields.length || finished) { fields = []; return; }
      const value = fields.join('\n'); fields = [];
      if (value.trim() === '[DONE]') { finished = true; return; }
      let event;
      try { event = JSON.parse(value); } catch { throw new Error('Groq 回复流格式异常，请重试。'); }
      if (event.error) throw requestError(400, event.error.message, secret);
      const choice = event.choices?.[0];
      const text = choice?.delta?.content;
      // Reasoning fields are deliberately ignored; only answer text is displayed.
      if (typeof text === 'string' && text) { content += text; onDelta(text); }
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    }
    function consume(final = false) {
      let match;
      while (!finished && (match = /\r\n|\r|\n/.exec(buffer))) {
        if (!final && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        if (!line) dispatch();
        else if (line.startsWith('data:')) fields.push(line.slice(5).replace(/^ /, ''));
      }
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
      if (signal.aborted) throw aborted();
      if (!finished) throw new Error('连接中断，回复未完整接收，请重试。');
      if (!content.trim()) throw new Error(finishReason === 'length' ? '本次思考已用完生成额度但未产生答案，请缩短问题或使用 Quick。' : 'Groq 没有返回可显示的答案。');
      return { content, finishReason };
    } catch (error) {
      if (signal.aborted) throw aborted();
      if (error instanceof TypeError) throw new Error('接收回复时连接中断，请检查网络后重试。');
      throw error;
    } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
  }
  window.GameCoachAI.registerProvider('groq', { isDemo: false, generate });
  function activate(key) {
    const clean = typeof key === 'string' ? key.trim() : '';
    if (!/^\S{16,512}$/.test(clean)) throw new Error('请输入完整的 Groq API Key，不要添加 Bearer 前缀。');
    window.GameCoachAI.configure({ provider: 'groq', modes: {
      quick: { model, reasoningEffort: 'none', maxOutputTokens: 256, timeoutMs: 10000,
        instructions: '用用户使用的语言直接回答。把可执行的结论放在第一句，再给一句简短理由。不要开场白，不要输出思考过程。' },
      coach: { model, reasoningEffort: 'medium', maxOutputTokens: 4096, timeoutMs: 60000,
        instructions: '用用户使用的语言回答。先给结论，再按需要解释依据和替代方案。缺少信息时明确说明，不要编造事实。不要输出内部思考过程。' },
    } });
    apiKey = clean;
  }
  function disconnect() {
    apiKey = '';
    // Remove live instructions too, rather than inheriting provider-specific settings.
    window.GameCoachAI.configure({ provider: 'demo', modes: {
      quick: { ...demoProfiles.quick, instructions: '' }, coach: { ...demoProfiles.coach, instructions: '' },
    } });
  }
  async function testConnection() {
    const secret = apiKey;
    if (!secret) throw new Error('请先填写密钥并启用 Groq。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await request('/models', { method: 'GET', signal: controller.signal }, secret);
      const data = await response.json();
      if (!Array.isArray(data.data) || !data.data.some(item => item.id === model)) throw new Error('密钥可用，但账号未列出当前 Qwen 模型，请检查模型权限。');
      return { model };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接测试超时，请检查网络后重试。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({ activate, disconnect, testConnection, isConfigured: () => !!apiKey, model });
})();
