// A customer on WhatsApp should never be left without an answer because one AI
// provider is down or rate-limited. Replies go through an ordered cascade:
// OpenAI first, then several Groq accounts with a large model, then the same
// accounts with a smaller model. Production uses 11 attempts in total.
//
// Each attempt is independent; the first valid answer wins. The cascade also
// counts which provider answered, which the admin panel shows as a diagnostic
// ("how many replies came from the fallback today").

function createCascade(attempts, { log = () => {} } = {}) {
  const stats = Object.fromEntries(attempts.map((a) => [a.label, 0]));
  stats.allFailed = 0;

  async function run(input) {
    for (const [i, attempt] of attempts.entries()) {
      if (!attempt.enabled) continue; // e.g. backup key not configured
      try {
        const out = await attempt.call(input);
        if (out) {
          stats[attempt.label] += 1;
          if (i > 0) log(`[ai] answered by fallback: ${attempt.label}`);
          return { text: out, provider: attempt.label };
        }
      } catch (err) {
        log(`[ai] ${attempt.label} failed: ${err.message}`);
      }
    }
    stats.allFailed += 1;
    return null; // caller falls back to a safe canned reply
  }

  return { run, stats: () => ({ ...stats }) };
}

module.exports = { createCascade };
