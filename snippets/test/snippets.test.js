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

const { cosine, contentHash, itemsToEmbed, semanticSearch, hybridSearch } = require('../hybrid-search');
const { score, NO_LEAKS } = require('../eval-scorer');

test('cosine: same direction = 1, orthogonal = 0, zero vector = 0', () => {
  assert.strictEqual(cosine([1, 2, 3], [2, 4, 6]).toFixed(6), '1.000000');
  assert.strictEqual(cosine([1, 0], [0, 1]), 0);
  assert.strictEqual(cosine([0, 0], [1, 1]), 0);
});

test('only new or edited items are re-embedded', () => {
  const model = 'text-embedding-3-small';
  const coke = { name: 'Coke 2L', category: 'Drinks' };
  coke.storedHash = contentHash(coke, model);
  const juice = { name: 'Orange juice', category: 'Drinks', storedHash: null }; // new
  const burger = { name: 'Burger', category: 'Food' };
  burger.storedHash = contentHash(burger, model);
  burger.description = 'now with bacon'; // edited after embedding
  assert.deepStrictEqual(itemsToEmbed([coke, juice, burger], model).map((i) => i.name), ['Orange juice', 'Burger']);
  assert.strictEqual(itemsToEmbed([coke], 'another-model').length, 1, 'changing the model re-embeds');
});

test('semantic search ranks by similarity and drops weak matches', () => {
  const items = [
    { code: 'B1', vector: [1, 0, 0] },
    { code: 'B2', vector: [0.9, 0.1, 0] },
    { code: 'F1', vector: [0, 1, 0] },
  ];
  const r = semanticSearch([1, 0, 0], items, { minScore: 0.5 });
  assert.deepStrictEqual(r.map((x) => x.item.code), ['B1', 'B2']);
});

test('hybrid search: keyword first, semantic only adds what was missing', async () => {
  const kw = [{ code: 'B2', name: 'Orange juice' }];
  const sem = [{ item: { code: 'B2' } }, { item: { code: 'B1', name: 'Coke' } }];
  const r = await hybridSearch({ keyword: async () => kw, semantic: async () => sem });
  assert.deepStrictEqual(r.map((i) => i.code), ['B2', 'B1']);
});

test('hybrid search survives the embeddings API being down', async () => {
  const r = await hybridSearch({
    keyword: async () => [{ code: 'B1' }],
    semantic: async () => { throw new Error('503'); },
  });
  assert.deepStrictEqual(r.map((i) => i.code), ['B1']);
});

test('eval scorer: correct order passes regardless of item order', () => {
  const expected = { event: 'order', items: [{ code: 'B1', qty: 1 }, { code: 'L1', qty: 1 }], payment: 'PIX', mustNotContain: NO_LEAKS };
  const reply = {
    reply: 'Done! Your order was sent.', event_type: 'order',
    order: { items: [{ external_code: 'L1', quantity: 1 }, { external_code: 'B1', quantity: 1 }], payment: 'PIX' },
  };
  assert.deepStrictEqual(score(expected, reply), []);
});

test('eval scorer: wrong quantity, wrong event and leaked JSON all fail', () => {
  const expected = { event: 'order', items: [{ code: 'B1', qty: 1 }], mustNotContain: NO_LEAKS };
  const reply = {
    reply: 'Ok {"event_type":"none"}', event_type: 'none',
    order: { items: [{ external_code: 'B1', quantity: 2 }] },
  };
  const f = score(expected, reply);
  assert.ok(f.some((x) => x.startsWith('event')));
  assert.ok(f.some((x) => x.startsWith('items')));
  assert.ok(f.some((x) => x.includes('must not contain')));
  assert.deepStrictEqual(score(expected, null), ['reply field missing']);
});
