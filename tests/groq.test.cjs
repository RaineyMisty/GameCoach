const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const TEST_KEY = 'test-credential-not-a-real-api-key';
function setup(fetch) {
  const context = { window: {}, fetch, setTimeout, clearTimeout, AbortController, DOMException, structuredClone, TextDecoder, performance };
  vm.createContext(context);
  for (const file of ['AI-Core/index.js', 'AI-Core/groq.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return { ai: context.window.GameCoachAI, groq: context.window.GameCoachGroq };
}
function sse(events, { split = 7, done = true } = {}) {
  const data = events.map(event => 'data: ' + JSON.stringify(event) + '\r\n\r\n').join('') + (done ? 'data: [DONE]\r\n\r\n' : '');
  const bytes = new TextEncoder().encode(data);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split)); controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
test('actual request uses official endpoint, isolated credentials and distinct execution parameters', async () => {
  const calls = [];
  const { ai, groq } = setup(async (url, options) => {
    calls.push({ url, options }); return sse([{ choices: [{ delta: { content: '选露露。' }, finish_reason: 'stop' }] }]);
  });
  groq.activate(TEST_KEY); const chunks = [];
  const quick = await ai.call([{ role: 'user', content: '选谁' }], { mode: 'quick', onDelta: text => chunks.push(text) });
  await ai.call('详细解释', { mode: 'coach' });
  const first = JSON.parse(calls[0].options.body); const second = JSON.parse(calls[1].options.body);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions'); assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + TEST_KEY);
  assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.redirect, 'error'); assert.ok(!calls[0].options.body.includes(TEST_KEY));
  assert.equal(first.model, 'qwen/qwen3.8-27b'); assert.equal(first.reasoning_effort, 'none'); assert.equal(first.max_completion_tokens, 256);
  assert.equal(second.reasoning_effort, 'medium'); assert.equal(second.max_completion_tokens, 4096); assert.equal(first.reasoning_format, 'hidden');
  assert.equal(first.stream, true); assert.equal(first.messages.at(-1).content, '选谁');
  assert.equal(quick.isDemo, false); assert.equal(quick.content, '选露露。'); assert.equal(chunks.join(''), '选露露。');
});
test('stream parser preserves UTF-8 across every byte and excludes reasoning', async () => {
  const { ai, groq } = setup(async () => sse([
    { choices: [{ delta: { reasoning: 'private chain', content: '选' } }] },
    { choices: [{ delta: { content: '露露🐟' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ], { split: 1 })); groq.activate(TEST_KEY);
  const chunks = []; const result = await ai.call('test', { onDelta: text => chunks.push(text) });
  assert.equal(result.content, '选露露🐟'); assert.equal(chunks.join(''), '选露露🐟');
});
test('SSE comments and multiline data events are parsed', async () => {
  const text = ': keep-alive\n\ndata: {"choices":\ndata: [{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const { ai, groq } = setup(async () => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } })); groq.activate(TEST_KEY);
  assert.equal((await ai.call('hello')).content, 'ok');
});
test('disconnect clears credentials and returns to demo, invalid keys never trigger fetch', async () => {
  let calls = 0; const { ai, groq } = setup(async () => { calls++; throw new Error('must not call'); });
  assert.throws(() => groq.activate('bad')); assert.equal(groq.isConfigured(), false);
  groq.activate(TEST_KEY); assert.equal(ai.getProviderName(), 'groq'); groq.disconnect();
  assert.equal(groq.isConfigured(), false); assert.equal(ai.getProviderName(), 'demo'); assert.equal(ai.getProfile('quick').model, 'demo-instant');
  assert.equal((await ai.call('hello')).isDemo, true); assert.equal(calls, 0); assert.equal('apiKey' in groq, false);
});
test('HTTP errors are actionable and do not disclose credentials', async () => {
  for (const status of [400, 401, 403, 404, 413, 429, 500]) {
    const { ai, groq } = setup(async () => new Response(JSON.stringify({ error: { message: 'invalid ' + TEST_KEY } }), { status, headers: { 'Content-Type': 'application/json', 'retry-after': '30' } }));
    groq.activate(TEST_KEY);
    await assert.rejects(ai.call('hello'), error => { assert.ok(!error.message.includes(TEST_KEY)); assert.equal(error.status, status); return true; });
  }
});
test('transport and provider stream failures never produce false successful replies', async () => {
  for (const response of [
    () => sse([{ choices: [{ delta: { content: 'partial' } }] }], { done: false }),
    () => sse([{ error: { message: 'stream failure' } }]),
    () => new Response('data: invalid-json\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }),
  ]) {
    const { ai, groq } = setup(async () => response()); groq.activate(TEST_KEY); await assert.rejects(ai.call('hello'));
  }
});
test('truncated answer is marked; reasoning-only budget exhaustion has a helpful error', async () => {
  const { ai, groq } = setup(async () => sse([{ choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }])); groq.activate(TEST_KEY);
  assert.equal((await ai.call('hello')).finishReason, 'length');
  const empty = setup(async () => sse([{ choices: [{ delta: { reasoning: 'hidden' }, finish_reason: 'length' }] }])); empty.groq.activate(TEST_KEY);
  await assert.rejects(empty.ai.call('hello'), /额度/);
});
test('JSON fallback emits answer and preserves finish reason', async () => {
  const { ai, groq } = setup(async () => Response.json({ choices: [{ message: { content: 'answer', reasoning: 'secret' }, finish_reason: 'stop' }] })); groq.activate(TEST_KEY);
  const chunks = []; const result = await ai.call('hello', { onDelta: x => chunks.push(x) }); assert.equal(chunks.join(''), 'answer'); assert.equal(result.finishReason, 'stop');
});
test('cancel propagates to fetch without leaving a pending response', async () => {
  let observed;
  const { ai, groq } = setup((url, options) => { observed = options.signal; return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')))); });
  groq.activate(TEST_KEY); const controller = new AbortController(); const result = ai.call('hello', { signal: controller.signal });
  await Promise.resolve(); controller.abort(); await assert.rejects(result, { name: 'AbortError' }); assert.equal(observed.aborted, true);
});
test('connection test only lists models, without a completion call', async () => {
  let count = 0;
  const { groq } = setup(async (url, options) => { count++; assert.equal(url, 'https://api.groq.com/openai/v1/models'); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); return Response.json({ data: [{ id: 'qwen/qwen3.8-27b' }] }); });
  groq.activate(TEST_KEY); assert.equal((await groq.testConnection()).model, groq.model); assert.equal(count, 1);
});
test('credentials are never written to browser or account storage', async () => {
  const source = fs.readFileSync(path.join(root, 'AI-Core/groq.js'), 'utf8') + fs.readFileSync(path.join(root, 'frontend/ai-settings.js'), 'utf8');
  assert.ok(!/localStorage|sessionStorage|GCStore/.test(source.replace(/\/\/[^\n]*/g, '')));
  const { groq } = setup(async () => Response.json({ data: [] })); groq.activate(TEST_KEY);
  assert.ok(!JSON.stringify(groq).includes(TEST_KEY));
});
