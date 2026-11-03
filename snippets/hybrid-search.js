// The AI never "remembers" a business's menu: on every message the backend
// retrieves the relevant items and injects them into the prompt (RAG).
//
// Keyword search is precise when the customer uses the item's name
// ("calabresa" -> "Pizza Calabresa") but finds nothing for "something to
// quench my thirst" or "a burger without meat". So retrieval is hybrid:
// keyword results stay first, and semantic search (embeddings + cosine
// similarity) only ADDS items the keyword search missed, with its own cap.
//
// No pgvector on purpose: one business has at most a few hundred items, so
// vectors live in a REAL[] column and the comparison runs in Node in well
// under a millisecond. Re-embedding only happens when an item's text or the
// embedding model changes (content hash), and if the embeddings API fails the
// keyword results are returned alone.

const crypto = require('crypto');

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// Category links "Coke 2L" to "drinks"; description carries "vegan", "serves 2".
function itemText(item) {
  return [item.category, item.name, item.description].filter(Boolean).join(' · ');
}

function contentHash(item, model) {
  return crypto.createHash('sha1').update(`${model}\n${itemText(item)}`).digest('hex');
}

// Items whose stored hash no longer matches: new, edited, or embedded with an
// older model. Only these go to the embeddings API.
function itemsToEmbed(items, model) {
  return items.filter((item) => item.storedHash !== contentHash(item, model));
}

function semanticSearch(queryVector, items, { minScore = 0.4, limit = 8 } = {}) {
  return items
    .map((item) => ({ item, score: cosine(queryVector, item.vector) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function hybridSearch({ keyword, semantic, maxExtras = 5 }) {
  const [kw, sem] = await Promise.all([
    keyword(),
    semantic().catch(() => []), // embeddings down: keyword search still answers
  ]);
  const seen = new Set(kw.map((i) => i.code));
  const extras = sem.map((r) => r.item).filter((i) => !seen.has(i.code)).slice(0, maxExtras);
  return [...kw, ...extras];
}

module.exports = { cosine, itemText, contentHash, itemsToEmbed, semanticSearch, hybridSearch };
