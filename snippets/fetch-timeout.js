// Every outbound call (OpenAI, Meta Graph API, Google Maps, Mercado Pago) goes
// through this helper. Without a timeout, one slow provider holds the request
// open and slowly drains the connection pool until the whole service stalls.
// Node 18+ ships AbortSignal.timeout natively, so no dependency is needed.

async function fetchTimeout(url, opts = {}, ms = 20000, fetchImpl = fetch) {
  try {
    return await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      const e = new Error(`timeout after ${ms}ms: ${String(url).slice(0, 80)}`);
      e.code = 'ETIMEDOUT';
      throw e;
    }
    throw err;
  }
}

module.exports = { fetchTimeout };
