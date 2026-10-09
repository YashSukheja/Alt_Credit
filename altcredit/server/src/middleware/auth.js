const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const AppError = require('../utils/AppError');

// 1) requireAuth: "are you logged in?"
// Reads "Authorization: Bearer <token>", verifies the signature and expiry,
// and puts the logged-in account on req.user for every later middleware/route.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Login required: send Authorization: Bearer <token>'));
  }
  try {
    // verify() throws if the token was tampered with or has expired
    const payload = jwt.verify(token, jwtSecret);
    req.user = {
      account_id: payload.sub,
      username: payload.username,
      role: payload.role,
      user_id: payload.user_id || null,         // only for role 'user'
      lender_name: payload.lender_name || null, // only for role 'lender'
    };
    return next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return next(new AppError(401, expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      expired ? 'Session expired, please log in again' : 'Invalid token'));
  }
}

// 2) requireRole('admin', 'lender'): "are you allowed on this route?"
// 401 = not logged in, 403 = logged in but not allowed
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Login required'));
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', `This action needs role: ${roles.join(' or ')}`));
    }
    return next();
  };
}

// 3) Ownership: a 'user' may only touch their OWN user_id. Admin may see anyone.
function assertCanAccessUser(reqUser, userId) {
  if (reqUser.role === 'admin') return;
  if (reqUser.role === 'user' && reqUser.user_id === userId) return;
  throw new AppError(403, 'FORBIDDEN', 'You can only access your own data');
}

module.exports = { requireAuth, requireRole, assertCanAccessUser };