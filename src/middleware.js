const config = require('./config');
const { findByApiKey } = require('./merchants');
const { ApiError, safeEqual } = require('./utils');

function requireMerchant(req, _res, next) {
  const header = req.get('authorization') || '';
  const key = req.get('x-api-key') || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!key) return next(new ApiError(401, 'UNAUTHORIZED', "X-API-Key header yuborilmadi"));
  const merchant = findByApiKey(key);
  if (!merchant) return next(new ApiError(401, 'UNAUTHORIZED', "API kalit noto'g'ri"));
  req.merchant = merchant;
  next();
}

function requireAdmin(req, _res, next) {
  const key = req.get('x-admin-key') || '';
  if (!key || !safeEqual(key, config.adminKey)) {
    return next(new ApiError(401, 'UNAUTHORIZED', "X-Admin-Key noto'g'ri"));
  }
  next();
}

function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: { code: 'INVALID_JSON', message: "So'rov tanasi yaroqli JSON emas" } });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Ichki server xatosi' } });
}

module.exports = { requireMerchant, requireAdmin, errorHandler };
