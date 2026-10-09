const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const { logAudit } = require('./auditService');

// GET /users/:id/offers -> offers sent to this user, newest first
async function listUserOffers(userId) {
  const { rows } = await query(
    `SELECT o.offer_id, o.status, o.created_at, o.responded_at, o.bank_reference,
            p.product_id, p.product_name, p.type, p.interest_rate, p.rate_unit,
            a.lender_name
     FROM offers o
     JOIN products p ON p.product_id = o.product_id
     JOIN accounts a ON a.account_id = o.lender_id
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC, o.offer_id DESC`,
    [userId],
  );
  return rows.map((r) => ({ ...r, interest_rate: r.interest_rate === null ? null : Number(r.interest_rate) }));
}

// POST /users/:id/offers/:offerId/reject
// One conditional UPDATE does the check AND the change together:
// it only succeeds if the offer belongs to this user AND is still pending.
// Two clicks at the same moment cannot both succeed (no race condition).
async function rejectOffer(userId, offerId, actor) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'INVALID_OFFER_ID', 'offerId must be a positive number');

  const { rows } = await query(
    `UPDATE offers SET status = 'rejected', responded_at = now()
     WHERE offer_id = $1 AND user_id = $2 AND status = 'pending'
     RETURNING offer_id, status, responded_at`,
    [id, userId],
  );

  // 0 rows updated: find out why, to give a useful message
  if (!rows.length) {
    const existing = (await query('SELECT status FROM offers WHERE offer_id = $1 AND user_id = $2', [id, userId])).rows[0];
    if (!existing) throw new AppError(404, 'OFFER_NOT_FOUND', `No offer ${id} for this user`);
    throw new AppError(409, 'OFFER_NOT_PENDING', `Offer is already ${existing.status}`);
  }

  await logAudit({ actor, action: 'OFFER_REJECTED', entity: 'offer', entityId: String(id), details: { user_id: userId } });
  return rows[0];
}

module.exports = { listUserOffers, rejectOffer };
