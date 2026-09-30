// Run with: node --test snippets/test
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { fetchTimeout } = require('../fetch-timeout');
const { isValidMetaSignature } = require('../verify-meta-signature');
const { createDeduper } = require('../dedupe');
const { createCascade } = require('../ai-cascade');
const { updateOrderStatus } = require('../tenant-scope');

test('fetchTimeout turns a hanging call into ETIMEDOUT', async () => {
  const hanging = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });
  await assert.rejects(fetchTimeout('https://slow.example', {}, 50, hanging), { code: 'ETIMEDOUT' });
});

test('fetchTimeout passes through a fast response', async () => {
  const fast = async () => ({ ok: true, status: 200 });
  const r = await fetchTimeout('https://fast.example', {}, 1000, fast);
  assert.strictEqual(r.status, 200);
});

test('Meta signature: valid, tampered and missing', () => {
  const secret = 'app-secret';
  const body = Buffer.from('{"entry":[{"id":"1"}]}');
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.strictEqual(isValidMetaSignature(body, sig, secret), true);
  assert.strictEqual(isValidMetaSignature(Buffer.from('{"entry":[{"id":"2"}]}'), sig, secret), false);
  assert.strictEqual(isValidMetaSignature(body, 'sha256=abc', secret), false);
  assert.strictEqual(isValidMetaSignature(body, undefined, secret), false);
});

test('deduper ignores the second delivery and forgets after the TTL', () => {
  let t = 0;
  const d = createDeduper({ ttlMs: 1000, now: () => t });
  assert.strictEqual(d.alreadyProcessed('wamid.1'), false);
  assert.strictEqual(d.alreadyProcessed('wamid.1'), true);
  t = 5000;
  d.sweep();
  assert.strictEqual(d.size(), 0);
  assert.strictEqual(d.alreadyProcessed('wamid.1'), false);
});

test('cascade falls through failing providers and counts who answered', async () => {
  const c = createCascade([
    { label: 'openai', enabled: true, call: async () => { throw new Error('429'); } },
    { label: 'groq-1', enabled: false, call: async () => 'never' },
    { label: 'groq-2', enabled: true, call: async () => 'Olá! Como posso ajudar?' },
  ]);
  const r = await c.run('oi');
  assert.deepStrictEqual(r, { text: 'Olá! Como posso ajudar?', provider: 'groq-2' });
  assert.strictEqual(c.stats()['groq-2'], 1);
});

test('cascade returns null when everything fails', async () => {
  const c = createCascade([{ label: 'openai', enabled: true, call: async () => { throw new Error('down'); } }]);
  assert.strictEqual(await c.run('oi'), null);
  assert.strictEqual(c.stats().allFailed, 1);
});

test('tenant scope: another business id cannot update the order', async () => {
  const orders = [{ id: 7, business_id: 1, status: 'pending' }];
  const db = { query: async (_sql, [status, biz, id]) => {
    const o = orders.find((x) => x.business_id === biz && x.id === id);
    if (o) o.status = status;
    return { rowCount: o ? 1 : 0 };
  } };
  const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };
  const handler = updateOrderStatus(db);
  const attacker = res();
  await handler({ session: { businessId: 2 }, params: { id: '7' }, body: { status: 'cancelled' } }, attacker);
  assert.strictEqual(attacker.code, 404);
  assert.strictEqual(orders[0].status, 'pending');
  const owner = res();
  await handler({ session: { businessId: 1 }, params: { id: '7' }, body: { status: 'confirmed' } }, owner);
  assert.strictEqual(owner.code, 200);
  assert.strictEqual(orders[0].status, 'confirmed');
});
