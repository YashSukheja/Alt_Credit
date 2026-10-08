const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { nodeEnv } = require('../config/env');

function notFound(req, res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
}

// Express knows this is an error handler because it has 4 arguments.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Malformed JSON body sent by the client
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
  }

  // Unexpected error: log everything, show the client nothing sensitive
  logger.error('Unhandled error', { message: err.message, stack: err.stack, path: req.originalUrl });
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: nodeEnv === 'production' ? 'Something went wrong' : err.message,
    },
  });
}

module.exports = { notFound, errorHandler };