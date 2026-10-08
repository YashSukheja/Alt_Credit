const { query } = require('../config/db');
const logger = require('../utils/logger');

// Audit must never break the main request: log the failure and carry on.
async function logAudit({ actor = 'anonymous', action, entity = null, entityId = null, details = null }, client) {
  const sql = 'INSERT INTO audit_log (actor, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)';
  const params = [actor, action, entity, entityId, details ? JSON.stringify(details) : null];
  try {
    if (client) await client.query(sql, params);
    else await query(sql, params);
  } catch (err) {
    logger.error('Audit log write failed', { action, error: err.message });
  }
}

module.exports = { logAudit };
