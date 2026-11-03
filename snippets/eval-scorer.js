// Unit tests prove the code around the model; they do not prove the model
// answers correctly. ZapSync has an eval set: real conversation turns
// (history + customer message) with the expected structured result, run
// against the live model with the same prompt, cascade and JSON schema used
// in production. It is run before changing a prompt or a model, several times
// per case because LLM output varies, with a minimum pass rate.
//
// The scorer is deterministic on purpose, with no LLM-as-judge: it compares
// fields of the structured reply and runs regexes over the customer-facing
// text, so the score measures the bot and not the judge.

function score(expected, reply) {
  if (!reply || typeof reply.reply !== 'string') return ['reply field missing'];
  const failures = [];

  if (expected.event && reply.event_type !== expected.event) {
    failures.push(`event: expected "${expected.event}", got "${reply.event_type}"`);
  }

  if (expected.items) {
    // order of items does not matter; code AND quantity do
    const got = (reply.order?.items || []).map((i) => `${i.external_code}x${i.quantity}`).sort().join(', ');
    const want = expected.items.map((i) => `${i.code}x${i.qty}`).sort().join(', ');
    if (got !== want) failures.push(`items: expected [${want}], got [${got || 'none'}]`);
  }

  if (expected.payment && reply.order?.payment !== expected.payment) {
    failures.push(`payment: expected ${expected.payment}, got ${reply.order?.payment ?? 'none'}`);
  }
  if (expected.date && reply.appointment?.data !== expected.date) {
    failures.push(`date: expected ${expected.date}, got ${reply.appointment?.data ?? 'none'}`);
  }

  for (const re of expected.mustNotContain || []) {
    if (re.test(reply.reply)) failures.push(`reply must not contain ${re}`);
  }
  return failures;
}

// Applied to every case: no JSON or internal markers may reach the customer.
const NO_LEAKS = [/ORDER_CONFIRMED|PEDIDO_CONFIRMADO/, /"event_type"/, /external_code/, /\{\s*"/];

module.exports = { score, NO_LEAKS };
