const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const TEST_KEY = 'test-credential-not-a-real-api-key';
function setup(fetch) {
  const context = { window: {}, fetch, setTimeout, clearTimeout, AbortController, DOMException, structuredClone, TextDecoder, performance, URL };
  vm.createContext(context);
  for (const file of ['ai-core/index.js', 'ai-core/gemini.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return { ai: context.window.GameCoachAI, gemini: context.window.GameCoachGemini };
}
function event(text, finishReason) { return { candidates: [{ index: 0, content: { parts: text === undefined ? [] : [{ text }] }, ...(finishReason ? { finishReason } : {}) }] }; }
function sse(events, { split = 7, delimiter = '\r\n', trailing = true } = {}) {
  let data = events.map(value => 'data: ' + JSON.stringify(value)).join(delimiter + delimiter);
  if (trailing) data += delimiter + delimiter;
  const bytes = new TextEncoder().encode(data);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split)); controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('real payload uses Google endpoint and header-only credentials; modes change models and thinking', async () => {
  const calls = [];
  const { ai, gemini } = setup(async (url, options) => { calls.push({ url, options }); return sse([event('选露露。', 'STOP')]); });
  gemini.activate(TEST_KEY); const chunks = [];
  const result = await ai.call([{ role: 'user', content: '选谁' }], { mode: 'quick', onDelta: value => chunks.push(value) });
  await ai.call('详细解释', { mode: 'coach' });
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse');
  assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
  for (const { url, options } of calls) {
    assert.equal(options.headers['x-goog-api-key'], TEST_KEY); assert.ok(!url.includes(TEST_KEY)); assert.ok(!options.body.includes(TEST_KEY));
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, undefined);
  }
  const quick = JSON.parse(calls[0].options.body); const coach = JSON.parse(calls[1].options.body);
  assert.equal(quick.generationConfig.thinkingConfig.thinkingLevel, 'MINIMAL'); assert.equal(quick.generationConfig.maxOutputTokens, 512);
  assert.equal(coach.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM'); assert.equal(coach.generationConfig.maxOutputTokens, 4096);
  assert.equal(quick.generationConfig.thinkingConfig.includeThoughts, false); assert.equal(quick.contents[0].parts[0].text, '选谁');
  assert.ok(quick.systemInstruction.parts[0].text); assert.equal(result.isDemo, false); assert.equal(result.finishReason, 'stop');
  assert.equal(chunks.join(''), '选露露。'); assert.equal(result.reasoningEffort, 'minimal');
});

test('same history is preserved and roles mapped while system instructions are kept separate', async () => {
  let payload;
  const { ai, gemini } = setup(async (url, options) => { payload = JSON.parse(options.body); return sse([event('answer', 'STOP')]); }); gemini.activate(TEST_KEY);
  const messages = [{ role: 'system', content: 'system info' }, { role: 'developer', content: 'extra' }, { role: 'user', content: 'first' },
    { role: 'assistant', content: 'answer' }, { role: 'user', content: 'follow up' }, { role: 'user', content: 'more' }];
  const original = JSON.stringify(messages); await ai.call(messages, { mode: 'coach' });
  assert.equal(JSON.stringify(messages), original); assert.deepEqual(payload.contents.map(item => item.role), ['user', 'model', 'user']);
  assert.equal(payload.contents[1].parts[0].text, 'answer'); assert.equal(payload.contents[2].parts[1].text, 'more');
  assert.deepEqual(payload.systemInstruction.parts.slice(-2), [{ text: 'system info' }, { text: 'extra' }]);
});

test('generic multimodal parts map to Gemini without fetching external image URLs', async () => {
  let payload; let calls = 0;
  const { ai, gemini } = setup(async (url, options) => { calls++; payload = JSON.parse(options.body); return sse([event('image', 'STOP')]); }); gemini.activate(TEST_KEY);
  await ai.call([{ role: 'user', content: [{ type: 'input_text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,dGVzdA==' } },
    { inlineData: { mimeType: 'audio/wav', data: 'YQ==' } }, { fileData: { mimeType: 'application/pdf', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/test' } }] }]);
  assert.deepEqual(payload.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'dGVzdA==' } }); assert.equal(calls, 1);
  await assert.rejects(ai.call([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/private.png' } }] }]), /不支持/); assert.equal(calls, 1);
});

test('UTF-8 survives one-byte chunks; thoughts and other candidates are never displayed', async () => {
  const { ai, gemini } = setup(async () => sse([
    { candidates: [{ index: 1, content: { parts: [{ text: 'unselected' }] } }] },
    { candidates: [{ index: 0, content: { parts: [{ text: 'private chain', thought: true }, { text: '选露' }] } }] },
    event('露🐟', 'STOP'),
  ], { split: 1 })); gemini.activate(TEST_KEY);
  const chunks = []; const result = await ai.call('test', { onDelta: value => chunks.push(value) });
  assert.equal(result.content, '选露露🐟'); assert.equal(chunks.join(''), result.content);
});

test('SSE handles line delimiters, final event without blank line, comments and multiline data', async () => {
  for (const delimiter of ['\n', '\r', '\r\n']) {
    const { ai, gemini } = setup(async () => sse([event('ok', 'STOP')], { split: 1, delimiter, trailing: false })); gemini.activate(TEST_KEY);
    assert.equal((await ai.call('hello')).content, 'ok');
  }
  const raw = ': keep-alive\n\nevent: message\ndata: {"candidates":\ndata: [{"content":{"parts":[{"text":"ok"}]},"finishReason":"STOP"}]}\n\n';
  const { ai, gemini } = setup(async () => new Response(raw, { headers: { 'Content-Type': 'text/event-stream' } })); gemini.activate(TEST_KEY);
  assert.equal((await ai.call('hello')).content, 'ok');
});

test('answer chunks reach the caller before generation completes', async () => {
  let finish; const encoder = new TextEncoder();
  const { ai, gemini } = setup(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('data: ' + JSON.stringify(event('first')) + '\n\n'));
    finish = () => { controller.enqueue(encoder.encode('data: ' + JSON.stringify(event(' second', 'STOP')) + '\n\n')); controller.close(); };
  } }), { headers: { 'Content-Type': 'text/event-stream' } })); gemini.activate(TEST_KEY);
  const chunks = []; const promise = ai.call('hello', { onDelta: value => chunks.push(value) });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.deepEqual(chunks, ['first']); finish();
  assert.equal((await promise).content, 'first second');
});

test('missing terminal state, malformed stream and upstream stream errors reject partial replies', async () => {
  for (const makeResponse of [
    () => sse([event('partial')]), () => sse([{ error: { code: 503, message: TEST_KEY } }]),
    () => new Response('data: invalid-json\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    () => new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('network')); } }), { headers: { 'Content-Type': 'text/event-stream' } }),
  ]) {
    const { ai, gemini } = setup(async () => makeResponse()); gemini.activate(TEST_KEY); await assert.rejects(ai.call('hello'));
  }
});

test('blocked prompts and abnormal finish reasons are errors, including after a partial answer', async () => {
  for (const events of [[{ promptFeedback: { blockReason: 'SAFETY' } }], [event('partial'), event(undefined, 'SAFETY')],
    [event('partial', 'RECITATION')], [event(undefined, 'UNEXPECTED_TOOL_CALL')]]) {
    const { ai, gemini } = setup(async () => sse(events)); gemini.activate(TEST_KEY); await assert.rejects(ai.call('hello'));
  }
});

test('MAX_TOKENS maps to existing truncation UI; empty thinking-only responses fail clearly', async () => {
  const { ai, gemini } = setup(async () => sse([event('partial', 'MAX_TOKENS')])); gemini.activate(TEST_KEY);
  assert.equal((await ai.call('hello')).finishReason, 'length');
  for (const reason of ['MAX_TOKENS', 'STOP']) {
    const empty = setup(async () => sse([{ candidates: [{ content: { parts: [{ text: 'hidden', thought: true }] }, finishReason: reason }] }])); empty.gemini.activate(TEST_KEY);
    await assert.rejects(empty.ai.call('hello'), reason === 'MAX_TOKENS' ? /额度/ : /没有返回/);
  }
});

test('JSON fallback requires successful completion and emits only answer text', async () => {
  const { ai, gemini } = setup(async () => Response.json(event('answer', 'STOP'))); gemini.activate(TEST_KEY);
  const chunks = []; assert.equal((await ai.call('hello', { onDelta: value => chunks.push(value) })).content, 'answer'); assert.deepEqual(chunks, ['answer']);
  const incomplete = setup(async () => Response.json(event('partial'))); incomplete.gemini.activate(TEST_KEY); await assert.rejects(incomplete.ai.call('hi'), /未完整/);
});

test('HTTP errors never echo credentials; key-invalid reason and retry-after are actionable', async () => {
  for (const status of [400, 401, 403, 404, 413, 429, 500, 503]) {
    const { ai, gemini } = setup(async () => new Response(JSON.stringify({ error: { message: TEST_KEY } }), { status, headers: { 'Content-Type': 'application/json', 'retry-after': '30' } })); gemini.activate(TEST_KEY);
    await assert.rejects(ai.call('hello'), error => { assert.equal(error.status, status); assert.ok(!error.message.includes(TEST_KEY)); if (status === 429) assert.match(error.message, /30/); return true; });
  }
  const invalid = setup(async () => new Response(JSON.stringify({ error: { message: TEST_KEY, details: [{ reason: 'API_KEY_INVALID' }] } }), { status: 400 })); invalid.gemini.activate(TEST_KEY);
  await assert.rejects(invalid.ai.call('hello'), /密钥/);
});

test('disconnect resets modes; invalid credentials never make network calls', async () => {
  let calls = 0; const { ai, gemini } = setup(async () => { calls++; throw new Error('must not call'); });
  for (const key of ['', 'short', 'Bearer key-with-unwanted-prefix', 'key with spaces in it']) assert.throws(() => gemini.activate(key));
  gemini.activate(TEST_KEY); assert.equal(ai.getProviderName(), 'gemini'); gemini.disconnect();
  assert.equal(gemini.isConfigured(), false); assert.equal(ai.getProviderName(), 'demo'); assert.equal(ai.getProfile('quick').model, 'demo-instant');
  assert.equal((await ai.call('hello')).isDemo, true); assert.equal(calls, 0); assert.equal('apiKey' in gemini, false);
});

test('cancel propagates to fetch without late output', async () => {
  let signal;
  const { ai, gemini } = setup((url, options) => { signal = options.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')))); }); gemini.activate(TEST_KEY);
  const controller = new AbortController(); const result = ai.call('hello', { signal: controller.signal }); await Promise.resolve(); controller.abort();
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(signal.aborted, true);
});

test('connection test reads both model metadata without generating content', async () => {
  const urls = [];
  const { gemini } = setup(async (url, options) => {
    urls.push(url); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.headers['x-goog-api-key'], TEST_KEY);
    return Response.json({ name: 'models/' + url.split('/').at(-1), supportedGenerationMethods: ['generateContent'] });
  }); gemini.activate(TEST_KEY); const result = await gemini.testConnection();
  assert.equal(urls.length, 2); assert.ok(urls.every(url => !url.includes(':') || url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/')));
  assert.equal(result.models.quick, 'gemini-3.5-flash-lite'); assert.equal(result.models.coach, 'gemini-3.8-flash');
  const missing = setup(async () => Response.json({ name: 'models/wrong', supportedGenerationMethods: [] })); missing.gemini.activate(TEST_KEY);
  await assert.rejects(missing.gemini.testConnection(), /未开放/);
});

test('invalid message shapes and unsupported thinking settings fail before network', async () => {
  let calls = 0; const { ai, gemini } = setup(async () => { calls++; throw new Error('must not call'); }); gemini.activate(TEST_KEY);
  for (const input of [[{ role: 'tool', content: 'test' }], [{ role: 'user', content: [{ type: 'unknown' }] }], [{ role: 'assistant', content: 'no user' }], [{ role: 'system', content: 'only system' }]]) await assert.rejects(ai.call(input));
  ai.configure({ modes: { quick: { reasoningEffort: 'none' } } }); await assert.rejects(ai.call('test'), /思考档位/); assert.equal(calls, 0);
});

test('credentials have no storage path or getter and reload starts in demo', () => {
  const source = fs.readFileSync(path.join(root, 'ai-core/gemini.js'), 'utf8') + fs.readFileSync(path.join(root, 'frontend/ai-settings.js'), 'utf8');
  assert.ok(!/localStorage|sessionStorage|GCStore/.test(source.replace(/\/\/[^\n]*/g, '')));
  const first = setup(async () => { throw new Error('unused'); }); first.gemini.activate(TEST_KEY); assert.ok(!JSON.stringify(first.gemini).includes(TEST_KEY));
  const reloaded = setup(async () => { throw new Error('unused'); }); assert.equal(reloaded.gemini.isConfigured(), false); assert.equal(reloaded.ai.getProviderName(), 'demo');
});


test('new AQ. auth keys, legacy AIza keys and longer opaque keys pass unchanged to Google', async () => {
  // Fabricated fixtures only; these are not real credentials.
  for (const key of ['AQ.' + 'test_only_'.repeat(20) + '.with-header-symbols_-/+=~', 'AIza' + 'x'.repeat(35), 'AQ.' + 'x'.repeat(1024)]) {
    let calls = 0;
    const { gemini } = setup(async (url, options) => {
      calls++; assert.equal(options.headers['x-goog-api-key'], key); assert.ok(!url.includes(key));
      return Response.json({ name: 'models/' + url.split('/').at(-1), supportedGenerationMethods: ['generateContent'] });
    });
    gemini.activate('  ' + key + '  '); assert.equal(gemini.isConfigured(), true);
    await gemini.testConnection(); assert.equal(calls, 2); assert.ok(!JSON.stringify(gemini).includes(key));
  }
});

test('unsafe pasted credentials are rejected locally without losing an existing connection', () => {
  let calls = 0; const { ai, gemini } = setup(async () => { calls++; throw new Error('must not call'); });
  gemini.activate(TEST_KEY);
  for (const key of ['"' + TEST_KEY + '"', "'" + TEST_KEY + "'", String.fromCharCode(96) + TEST_KEY + String.fromCharCode(96),
    'AQ.test only with spaces', 'AQ.test\nembedded-newline', 'AQ.test\rembedded-carriage-return', 'AQ.test\tembedded-tab',
    'AQ.test' + String.fromCharCode(0) + 'control-character', 'AQ.test' + String.fromCharCode(127) + 'delete-character',
    'AQ.test' + String.fromCharCode(0x200b) + 'invisible-character', 'Bearer ' + TEST_KEY, 'x'.repeat(8193)]) {
    assert.throws(() => gemini.activate(key), /格式检查未通过/); assert.equal(gemini.isConfigured(), true); assert.equal(ai.getProviderName(), 'gemini');
  }
  assert.equal(calls, 0);
});

test('Google Search is optional and actual grounding metadata carries safe sources, suggestions and token usage', async () => {
  const payloads = []; const answer = event('参考官方资料', 'STOP');
  answer.candidates[0].groundingMetadata = {
    webSearchQueries: ['Corki patch'], searchEntryPoint: { renderedContent: '<div>Search suggestions</div>' },
    groundingChunks: [{ web: { uri: 'https://wildrift.leagueoflegends.com/', title: 'Wild Rift' } },
      { web: { uri: 'javascript:alert(1)', title: 'unsafe' } }, { web: { uri: 'https://wildrift.leagueoflegends.com/', title: 'duplicate' } }],
  };
  answer.usageMetadata = { promptTokenCount: 100, candidatesTokenCount: 40, totalTokenCount: 150 };
  const { ai, gemini } = setup(async (url, options) => { payloads.push(JSON.parse(options.body)); return sse([answer]); });
  gemini.activate(TEST_KEY); const result = await ai.call('核实技能', { webSearch: true }); await ai.call('你好');
  assert.deepEqual(payloads[0].tools, [{ googleSearch: {} }]); assert.equal(payloads[1].tools, undefined);
  assert.equal(result.sources.length, 1); assert.equal(result.sources[0].kind, 'web');
  assert.match(result.searchSuggestions, /Search suggestions/); assert.equal(result.searched, true);
  assert.equal(result.usage.totalTokens, 150); assert.equal(result.usage.inputTokens, 100);
});

test('HTTP 503 retries before text and succeeds while 401 does not retry', async () => {
  for (const status of [503, 401]) {
    let calls = 0; const { ai, gemini } = setup(async () => {
      calls++; return calls === 1 ? new Response('{}', { status }) : sse([event('恢复了', 'STOP')]);
    }); gemini.activate(TEST_KEY); ai.configure({ modes: { quick: { retryDelayMs: 0 } } });
    if (status === 503) { const result = await ai.call('hi'); assert.equal(result.content, '恢复了'); assert.equal(result.attempts, 2); }
    else await assert.rejects(ai.call('hi'), error => error.attempts === 1);
    assert.equal(calls, status === 503 ? 2 : 1);
  }
});
