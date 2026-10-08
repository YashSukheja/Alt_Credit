const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const meta = { status: res.statusCode, ms: Date.now() - start };
    const msg = `${req.method} ${req.originalUrl}`;
    if (res.statusCode >= 500) logger.error(msg, meta);
    else if (res.statusCode >= 400) logger.warn(msg, meta);
    else logger.info(msg, meta);
  });
  next();
}

module.exports = requestLogger;