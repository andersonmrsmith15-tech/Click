const crypto = require('node:crypto');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomKey = (prefix, bytes = 24) => `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;

/** so'm (masalan 15000.50) -> tiyin (1500050) */
function toTiyin(value, field = 'amount') {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', `${field} musbat son bo'lishi kerak`);
  }
  const t = Math.round(n * 100);
  if (Math.abs(t - n * 100) > 1e-6) {
    throw new ApiError(400, 'INVALID_AMOUNT', `${field} ko'pi bilan 2 xona kasrga ega bo'lishi mumkin`);
  }
  if (t > 1e15) throw new ApiError(400, 'INVALID_AMOUNT', `${field} juda katta`);
  return t;
}
const toSum = (tiyin) => tiyin / 100;

function normalizeCardNumber(raw) {
  const num = String(raw ?? '').replace(/[\s-]/g, '');
  if (!/^\d{16}$/.test(num)) {
    throw new ApiError(400, 'INVALID_CARD_NUMBER', "Karta raqami 16 ta raqamdan iborat bo'lishi kerak");
  }
  return num;
}

/** "MM/YY" yoki "MMYY" -> "MM/YY", muddati o'tganini tekshiradi */
function normalizeExpiry(raw) {
  const m = String(raw ?? '').replace(/\s/g, '').match(/^(\d{2})\/?(\d{2})$/);
  if (!m) throw new ApiError(400, 'INVALID_EXPIRY', "Amal qilish muddati MM/YY formatida bo'lishi kerak");
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) throw new ApiError(400, 'INVALID_EXPIRY', "Oy 01-12 oralig'ida bo'lishi kerak");
  const endOfMonth = new Date(Date.UTC(year, month, 1));
  if (endOfMonth <= new Date()) throw new ApiError(400, 'CARD_EXPIRED', "Karta muddati o'tgan");
  return `${m[1]}/${m[2]}`;
}

const maskCard = (num) => `${num.slice(0, 4)} ${num.slice(4, 6)}** **** ${num.slice(12)}`;

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  ApiError, now, id, sha256, randomKey, toTiyin, toSum,
  normalizeCardNumber, normalizeExpiry, maskCard, safeEqual,
};
