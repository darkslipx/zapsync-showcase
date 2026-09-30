// Multi-tenant isolation rule used across the whole admin API:
// business_id comes ONLY from the signed session, never from the URL,
// the query string or the request body. A logged-in owner cannot read or
// change another business's orders by editing an id in the request.
//
// Every query is written with the tenant filter as the first condition,
// and the test suite has cases that try to cross tenants on purpose.

function requireSession(req, res, next) {
  if (!req.session || !req.session.businessId) {
    return res.status(401).json({ error: 'not authenticated' });
  }
  next();
}

// Example handler: update an order status.
function updateOrderStatus(db) {
  return async (req, res) => {
    const businessId = req.session.businessId; // trusted
    const orderId = Number(req.params.id);      // untrusted, only used together with businessId
    const { status } = req.body;
    if (!['pending', 'confirmed', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    const r = await db.query(
      'UPDATE orders SET status = $1 WHERE business_id = $2 AND id = $3 RETURNING id',
      [status, businessId, orderId],
    );
    // Same 404 for "does not exist" and "belongs to someone else": no information leak.
    if (r.rowCount === 0) return res.status(404).json({ error: 'order not found' });
    res.json({ ok: true });
  };
}

module.exports = { requireSession, updateOrderStatus };
