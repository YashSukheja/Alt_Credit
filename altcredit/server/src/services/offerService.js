const { query, withTransaction } = require('../config/db');
const AppError = require('../utils/AppError');
const { logAudit } = require('./auditService');
const { scoreProfile } = require('../engine/scorer');
const { getScoringProfile } = require('./userService');
const { anonRef } = require('../utils/anonymise');
const { submitApplication } = require('../clients/bankClient');

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

function parseOfferId(offerId) {
  const id = Number(offerId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'INVALID_OFFER_ID', 'offerId must be a positive number');
  return id;
}

// Explains why a pending-only action could not run (not found vs already answered)
async function explainNotPending(id, userId, run = query) {
  const existing = (await run('SELECT status FROM offers WHERE offer_id = $1 AND user_id = $2', [id, userId])).rows[0];
  if (!existing) throw new AppError(404, 'OFFER_NOT_FOUND', `No offer ${id} for this user`);
  throw new AppError(409, 'OFFER_NOT_PENDING', `Offer is already ${existing.status}`);
}

// POST /users/:id/offers/:offerId/reject
// One conditional UPDATE does the check AND the change together (race-safe, see step 5).
async function rejectOffer(userId, offerId, actor) {
  const id = parseOfferId(offerId);
  const { rows } = await query(
    `UPDATE offers SET status = 'rejected', responded_at = now()
     WHERE offer_id = $1 AND user_id = $2 AND status = 'pending'
     RETURNING offer_id, status, responded_at`,
    [id, userId],
  );
  if (!rows.length) await explainNotPending(id, userId);

  await logAudit({ actor, action: 'OFFER_REJECTED', entity: 'offer', entityId: String(id), details: { user_id: userId } });
  return rows[0];
}

// POST /users/:id/offers/:offerId/accept
//
//  1. Lock the offer row (SELECT ... FOR UPDATE) so a double click waits instead of running twice
//  2. Re-check the score NOW: if it dropped below the product minimum, revoke the offer
//  3. Call the bank (timeout + retry + Idempotency-Key)
//  4. Save the bank's answer and COMMIT
//  If the bank is down: ROLLBACK -> the offer simply stays 'pending', user can retry later.
async function acceptOffer(userId, offerId, actor) {
  const id = parseOfferId(offerId);

  const outcome = await withTransaction(async (client) => {
    // ---- 1. Lock ----
    // FOR UPDATE: other transactions trying to lock this same row WAIT until we commit/rollback.
    // So two "accept" clicks run one after the other; the second sees status = 'accepted'.
    const { rows } = await client.query(
      `SELECT o.offer_id, o.status, o.product_id, p.product_name, p.min_score, a.lender_name
       FROM offers o
       JOIN products p ON p.product_id = o.product_id
       JOIN accounts a ON a.account_id = o.lender_id
       WHERE o.offer_id = $1 AND o.user_id = $2
       FOR UPDATE OF o`,
      [id, userId],
    );
    const offer = rows[0];
    if (!offer) throw new AppError(404, 'OFFER_NOT_FOUND', `No offer ${id} for this user`);
    if (offer.status !== 'pending') throw new AppError(409, 'OFFER_NOT_PENDING', `Offer is already ${offer.status}`);

    // ---- 2. Fresh score check (the user's behaviour may have changed since the offer was sent) ----
    const { score } = scoreProfile(await getScoringProfile(userId));
    if (score < offer.min_score) {
      await client.query(
        "UPDATE offers SET status = 'revoked', responded_at = now() WHERE offer_id = $1", [id],
      );
      return { kind: 'revoked', offer, score };
    }

    // ---- 3. Call the bank ----
    // Idempotency-Key is derived from the offer id: retries (ours OR a later user retry)
    // for this offer always map to the same bank application, never a second one.
    // The bank only gets the anonymous ref, never our internal user_id.
    const bank = await submitApplication(
      { user_ref: anonRef(userId), product_id: offer.product_id, score, offer_id: id },
      { idempotencyKey: `altcredit-offer-${id}` },
    );
    // (if the bank call throws, withTransaction rolls back and the offer stays 'pending')

    // ---- 4. Save the bank's decision ----
    const newStatus = bank.status === 'APPROVED' ? 'accepted' : 'revoked';
    const saved = await client.query(
      `UPDATE offers SET status = $2, responded_at = now(), bank_reference = $3
       WHERE offer_id = $1 RETURNING offer_id, status, responded_at, bank_reference`,
      [id, newStatus, bank.application_id],
    );
    return { kind: newStatus, offer, score, bank, saved: saved.rows[0] };
  });

  // Audit AFTER commit, so we never log something that was rolled back
  if (outcome.kind === 'revoked' && !outcome.bank) {
    await logAudit({ actor, action: 'OFFER_REVOKED', entity: 'offer', entityId: String(id),
      details: { user_id: userId, reason: 'score_below_minimum', score: outcome.score, min_score: outcome.offer.min_score } });
    throw new AppError(409, 'OFFER_REVOKED',
      `Your score is now ${outcome.score}, below the ${outcome.offer.min_score} needed for ${outcome.offer.product_name}. The offer was withdrawn.`);
  }

  await logAudit({ actor, action: outcome.kind === 'accepted' ? 'OFFER_ACCEPTED' : 'OFFER_DECLINED_BY_BANK',
    entity: 'offer', entityId: String(id),
    details: { user_id: userId, bank_reference: outcome.bank.application_id, bank_status: outcome.bank.status } });

  return {
    offer_id: id,
    status: outcome.saved.status,
    product: { product_id: outcome.offer.product_id, product_name: outcome.offer.product_name },
    lender_name: outcome.offer.lender_name,
    bank: {
      reference: outcome.bank.application_id,
      status: outcome.bank.status,
      credit_limit: outcome.bank.credit_limit ?? null,
      loan_amount: outcome.bank.loan_amount ?? null,
      reason: outcome.bank.reason ?? null,
    },
    message: outcome.kind === 'accepted'
      ? `Approved by the bank. Your lender can now see your profile. Reference ${outcome.bank.application_id}.`
      : `The bank declined: ${outcome.bank.reason}`,
  };
}

module.exports = { listUserOffers, rejectOffer, acceptOffer };