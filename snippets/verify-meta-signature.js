// Meta signs every webhook call with HMAC-SHA256 of the raw body using the
// app secret, in the X-Hub-Signature-256 header. Without this check, anyone who
// discovers the webhook URL could forge "customer" messages and even create
// fake orders in the restaurant's POS.
//
// Two details matter:
//  1. The HMAC must be computed over the RAW body bytes, not re-serialized JSON
//     (express.json({ verify }) keeps req.rawBody for that).
//  2. The comparison must be constant-time (timingSafeEqual) so the signature
//     cannot be guessed byte by byte through response timing.

const crypto = require('crypto');

function isValidMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader || !rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { isValidMetaSignature };
