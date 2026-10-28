const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function setup(generate, options = {}) {
  const ctx = { window: {}, structuredClone, setTimeout, clearTimeout, AbortController, DOMException, performance };
  vm.createContext(ctx); for (const file of ['demo.js', 'index.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../ai-core', file), 'utf8'), ctx);
  const core = ctx.window.GameCoachAI; core.registerProvider('fake', { generate });
  core.configure({ provider: 'fake', modes: { quick: { retryDelayMs: 0, timeoutMs: 1000, ...options } } }); return core;
}
const failure = extra => Object.assign(new Error('temporary'), { retryable: true, ...extra });
test('transient calls retry at most three times, retaining exact input and final stream', async () => {
  let calls = 0; const retries = [], chunks = [];
  const core = setup(async request => { calls++; assert.equal(request.input[0].content, 'original'); request.input[0].content = 'mutated';
    if (calls < 3) throw failure(); request.onDelta('成功'); return { content: '成功' }; });
  const response = await core.call([{ role: 'user', content: 'original' }], { onRetry: value => retries.push(value.attempt), onDelta: value => chunks.push(value) });
  assert.equal(calls, 3); assert.equal(response.attempts, 3); assert.deepEqual(retries, [2, 3]); assert.deepEqual(chunks, ['成功']);
});
test('three transient failures stop and report actual attempts', async () => {
  let calls = 0; const core = setup(async () => { calls++; throw failure(); });
  await assert.rejects(core.call('hello'), error => error.attempts === 3); assert.equal(calls, 3);
});
test('invalid requests are not retried and partial answers are never concatenated with a new generation', async () => {
  for (const partial of [false, true]) {
    let calls = 0; const chunks = []; const core = setup(async ({ onDelta }) => { calls++; if (partial) onDelta('半句'); throw failure({ retryable: partial }); });
    await assert.rejects(core.call('hi', { onDelta: text => chunks.push(text) }), error => error.attempts === 1);
    assert.equal(calls, 1); assert.deepEqual(chunks, partial ? ['半句'] : []);
  }
});
test('Retry-After exceeding the shared deadline does not hammer the server', async () => {
  let calls = 0; const core = setup(async () => { calls++; throw failure({ retryAfterMs: 5000 }); });
  await assert.rejects(core.call('hi')); assert.equal(calls, 1);
});
test('cancellation interrupts backoff without making the next request', async () => {
  const controller = new AbortController(); let calls = 0;
  const core = setup(async () => { calls++; throw failure(); }, { retryDelayMs: 100 });
  await assert.rejects(core.call('hi', { signal: controller.signal, onRetry: () => controller.abort() }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('all attempts share one deadline rather than each receiving a fresh timeout', async () => {
  let calls = 0; const core = setup(async () => { calls++; if (calls === 1) throw failure(); return new Promise(() => {}); }, { timeoutMs: 400 });
  const started = performance.now(); await assert.rejects(core.call('hi'), error => error.name === 'TimeoutError' && error.attempts === 2);
  assert.equal(calls, 2); assert.ok(performance.now() - started < 900);
});
