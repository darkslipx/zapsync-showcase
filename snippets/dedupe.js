// Meta may deliver the same webhook more than once (a slow 200 on our side,
// network hiccups). Without deduplication, the same customer message was
// processed twice and the bot answered twice in the conversation.
// Message ids are kept for 10 minutes, far longer than any Meta retry window,
// and old entries are swept so memory stays flat.

const DEDUPE_TTL_MS = 10 * 60 * 1000;

function createDeduper({ ttlMs = DEDUPE_TTL_MS, now = Date.now } = {}) {
  const seen = new Map(); // messageId -> timestamp

  function sweep() {
    const limit = now() - ttlMs;
    for (const [id, at] of seen) if (at < limit) seen.delete(id);
  }

  function alreadyProcessed(messageId) {
    if (!messageId) return false;
    if (seen.has(messageId)) return true;
    seen.set(messageId, now());
    return false;
  }

  return { alreadyProcessed, sweep, size: () => seen.size };
}

module.exports = { createDeduper };
