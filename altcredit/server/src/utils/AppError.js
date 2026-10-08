// Throw this for any error you expect (bad input, not found, forbidden).
// Anything else that gets thrown is treated as an unexpected 500.
class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

module.exports = AppError;