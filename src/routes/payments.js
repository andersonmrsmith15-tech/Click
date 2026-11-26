const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const { db, transaction } = require('../db');
const { sendWebhook } = require('../webhook');
const {
  ApiError, id, now, sha256, toTiyin, toSum, normalizeCardNumber, normalizeExpiry, maskCard, safeEqual,
} = require('../utils');

const router = express.Router();

const genOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const otpHash = (paymentId, code) => sha256(`${paymentId}:${code}`);

function publicPayment(p, card) {
  card = card || db.prepare('SELECT number FROM cards WHERE id = ?').get(p.card_id);
  return {
    payment_id: p.id,
    status: p.status,
    amount: toSum(p.amount),
    currency: 'UZS',
    order_id: p.order_id,
    description: p.description,
    card_number: card ? maskCard(card.number) : null,
    error_code: p.error_code,
    otp_expires_at: p.status === 'pending' ? p.otp_expires_at : undefined,
    created_at: p.created_at,
    updated_at: p.updated_at,
    completed_at: p.completed_at,
  };
}

function getOwnPayment(req) {
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!p || p.merchant_id !== req.merchant.id) throw new ApiError(404, 'PAYMENT_NOT_FOUND', "To'lov topilmadi");
  return p;
}

function resolveCard(body) {
  if (body.card_token) {
    const card = db.prepare('SELECT * FROM cards WHERE token = ?').get(String(body.card_token));
    if (!card) throw new ApiError(404, 'CARD_NOT_FOUND', 'Karta topilmadi');
    return card;
  }
  const number = normalizeCardNumber(body.card_number);
  const expiry = normalizeExpiry(body.expiry);
  const card = db.prepare('SELECT * FROM cards WHERE number = ?').get(number);
  // Karta yo'q yoki muddat mos emas -> bir xil xato (raqamlarni taxmin qilishni qiyinlashtirish uchun)
  if (!card || card.expiry !== expiry) throw new ApiError(404, 'CARD_NOT_FOUND', "Karta topilmadi yoki muddati noto'g'ri");
  return card;
}

/** Kartadan pulni yechish (tranzaksiya ichida chaqiriladi). Xato bo'lsa error_code qaytaradi. */
function debit(payment) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(payment.card_id);
  const ts = now();
  let errorCode = null;
  if (card.status !== 'active') errorCode = 'CARD_BLOCKED';
  else if (card.balance < payment.amount) errorCode = 'INSUFFICIENT_FUNDS';

  if (errorCode) {
    db.prepare("UPDATE payments SET status = 'failed', error_code = ?, otp_hash = NULL, updated_at = ? WHERE id = ?")
      .run(errorCode, ts, payment.id);
    return { ...payment, status: 'failed', error_code: errorCode, otp_hash: null, updated_at: ts };
  }

  const newBalance = card.balance - payment.amount;
  db.prepare('UPDATE cards SET balance = ?, updated_at = ? WHERE id = ?').run(newBalance, ts, card.id);
  db.prepare(`INSERT INTO transactions (id, card_id, payment_id, type, amount, balance_after, created_at)
              VALUES (?, ?, ?, 'debit', ?, ?, ?)`).run(id('tx'), card.id, payment.id, -payment.amount, newBalance, ts);
  db.prepare("UPDATE payments SET status = 'completed', otp_hash = NULL, updated_at = ?, completed_at = ? WHERE id = ?")
    .run(ts, ts, payment.id);
  return { ...payment, status: 'completed', otp_hash: null, updated_at: ts, completed_at: ts };
}

function errorFor(p) {
  if (p.error_code === 'INSUFFICIENT_FUNDS') return new ApiError(402, 'INSUFFICIENT_FUNDS', "Kartada mablag' yetarli emas");
  if (p.error_code === 'CARD_BLOCKED') return new ApiError(403, 'CARD_BLOCKED', 'Karta bloklangan');
  return null;
}

/**
 * 1-qadam: to'lov yaratish.
 * Body: { card_number, expiry } yoki { card_token }, amount, order_id?, description?, auto_confirm?
 * auto_confirm=true faqat card_token bilan ishlaydi (OTP'siz darhol yechiladi).
 */
router.post('/', (req, res) => {
  const body = req.body || {};
  const amount = toTiyin(body.amount);
  const orderId = body.order_id != null ? String(body.order_id) : null;
  const description = body.description != null ? String(body.description).slice(0, 500) : null;
  const autoConfirm = body.auto_confirm === true;
  if (autoConfirm && !body.card_token) {
    throw new ApiError(400, 'AUTO_CONFIRM_REQUIRES_TOKEN', "auto_confirm faqat card_token bilan ishlatiladi");
  }

  // Idempotentlik: bir xil order_id qayta yuborilsa mavjud to'lov qaytariladi
  if (orderId) {
    const existing = db.prepare('SELECT * FROM payments WHERE merchant_id = ? AND order_id = ?').get(req.merchant.id, orderId);
    if (existing) {
      if (existing.amount !== amount) {
        throw new ApiError(409, 'ORDER_ID_CONFLICT', "Bu order_id boshqa summa bilan allaqachon ishlatilgan");
      }
      return res.status(200).json({ ok: true, idempotent: true, payment: publicPayment(existing) });
    }
  }

  const card = resolveCard(body);
  if (card.status !== 'active') throw new ApiError(403, 'CARD_BLOCKED', 'Karta bloklangan');
  if (card.balance < amount) throw new ApiError(402, 'INSUFFICIENT_FUNDS', "Kartada mablag' yetarli emas");

  const ts = now();
  const paymentId = id('pay');
  const otp = autoConfirm ? null : genOtp();
  let payment = {
    id: paymentId, merchant_id: req.merchant.id, card_id: card.id, amount, status: 'pending',
    order_id: orderId, description,
    otp_hash: otp ? otpHash(paymentId, otp) : null,
    otp_expires_at: otp ? new Date(Date.now() + config.otpTtlSeconds * 1000).toISOString() : null,
    otp_attempts: 0, error_code: null, created_at: ts, updated_at: ts, completed_at: null,
  };

  payment = transaction(() => {
    db.prepare(`INSERT INTO payments (id, merchant_id, card_id, amount, status, order_id, description, otp_hash, otp_expires_at, otp_attempts, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?, ?)`)
      .run(payment.id, payment.merchant_id, payment.card_id, payment.amount, payment.order_id, payment.description,
           payment.otp_hash, payment.otp_expires_at, payment.created_at, payment.updated_at);
    return autoConfirm ? debit(payment) : payment;
  });

  if (autoConfirm) {
    sendWebhook(req.merchant.id, `payment.${payment.status}`, publicPayment(payment, card));
    const err = errorFor(payment);
    if (err) throw err;
    return res.status(201).json({ ok: true, payment: publicPayment(payment, card) });
  }

  if (!config.demoMode) {
    // Haqiqiy tizimda bu yerda SMS yuboriladi
    console.log(`[sms] ${card.phone || maskCard(card.number)} -> tasdiqlash kodi: ${otp}`);
  }
  res.status(201).json({
    ok: true,
    payment: publicPayment(payment, card),
    ...(config.demoMode ? { otp_code: otp, otp_note: "DEMO_MODE: haqiqiy tizimda bu kod SMS orqali yuboriladi" } : {}),
  });
});

/** 2-qadam: OTP kod bilan tasdiqlash -> pul yechiladi */
router.post('/:id/confirm', (req, res) => {
  const code = String(req.body?.otp ?? req.body?.code ?? '');
  const outcome = transaction(() => {
    const p = getOwnPayment(req);
    if (p.status !== 'pending') return { error: new ApiError(409, 'INVALID_STATE', `To'lov holati: ${p.status}`) };

    const ts = now();
    if (new Date(p.otp_expires_at) < new Date()) {
      db.prepare("UPDATE payments SET status = 'expired', otp_hash = NULL, updated_at = ? WHERE id = ?").run(ts, p.id);
      return { error: new ApiError(410, 'OTP_EXPIRED', "Tasdiqlash kodi muddati o'tgan"), payment: { ...p, status: 'expired', updated_at: ts } };
    }
    if (!safeEqual(otpHash(p.id, code), p.otp_hash)) {
      const attempts = p.otp_attempts + 1;
      if (attempts >= config.otpMaxAttempts) {
        db.prepare("UPDATE payments SET status = 'failed', error_code = 'OTP_ATTEMPTS_EXCEEDED', otp_hash = NULL, otp_attempts = ?, updated_at = ? WHERE id = ?")
          .run(attempts, ts, p.id);
        return {
          error: new ApiError(403, 'OTP_ATTEMPTS_EXCEEDED', "Urinishlar soni tugadi, to'lov bekor qilindi"),
          payment: { ...p, status: 'failed', error_code: 'OTP_ATTEMPTS_EXCEEDED', updated_at: ts },
        };
      }
      db.prepare('UPDATE payments SET otp_attempts = ?, updated_at = ? WHERE id = ?').run(attempts, ts, p.id);
      return { error: new ApiError(400, 'INVALID_OTP', `Kod noto'g'ri. Qolgan urinishlar: ${config.otpMaxAttempts - attempts}`) };
    }
    const done = debit(p);
    return { payment: done, error: errorFor(done) };
  });

  if (outcome.payment) sendWebhook(req.merchant.id, `payment.${outcome.payment.status}`, publicPayment(outcome.payment));
  if (outcome.error) throw outcome.error;
  res.json({ ok: true, payment: publicPayment(outcome.payment) });
});

/** OTP kodni qayta yuborish */
router.post('/:id/resend-otp', (req, res) => {
  const p = getOwnPayment(req);
  if (p.status !== 'pending') throw new ApiError(409, 'INVALID_STATE', `To'lov holati: ${p.status}`);
  const otp = genOtp();
  const ts = now();
  const expires = new Date(Date.now() + config.otpTtlSeconds * 1000).toISOString();
  db.prepare('UPDATE payments SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0, updated_at = ? WHERE id = ?')
    .run(otpHash(p.id, otp), expires, ts, p.id);
  if (!config.demoMode) console.log(`[sms] payment ${p.id} -> yangi kod: ${otp}`);
  res.json({
    ok: true,
    payment: publicPayment({ ...p, otp_expires_at: expires, updated_at: ts }),
    ...(config.demoMode ? { otp_code: otp } : {}),
  });
});

/** Bekor qilish: pending -> cancelled, completed -> refunded (pul kartaga qaytadi) */
router.post('/:id/cancel', (req, res) => {
  const payment = transaction(() => {
    const p = getOwnPayment(req);
    const ts = now();
    if (p.status === 'pending') {
      db.prepare("UPDATE payments SET status = 'cancelled', otp_hash = NULL, updated_at = ? WHERE id = ?").run(ts, p.id);
      return { ...p, status: 'cancelled', updated_at: ts };
    }
    if (p.status === 'completed') {
      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(p.card_id);
      const newBalance = card.balance + p.amount;
      db.prepare('UPDATE cards SET balance = ?, updated_at = ? WHERE id = ?').run(newBalance, ts, card.id);
      db.prepare(`INSERT INTO transactions (id, card_id, payment_id, type, amount, balance_after, created_at)
                  VALUES (?, ?, ?, 'refund', ?, ?, ?)`).run(id('tx'), card.id, p.id, p.amount, newBalance, ts);
      db.prepare("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?").run(ts, p.id);
      return { ...p, status: 'refunded', updated_at: ts };
    }
    throw new ApiError(409, 'INVALID_STATE', `Bu holatdagi to'lovni bekor qilib bo'lmaydi: ${p.status}`);
  });
  sendWebhook(req.merchant.id, `payment.${payment.status}`, publicPayment(payment));
  res.json({ ok: true, payment: publicPayment(payment) });
});

router.get('/:id', (req, res) => {
  res.json({ ok: true, payment: publicPayment(getOwnPayment(req)) });
});

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = ['merchant_id = ?'];
  const params = [req.merchant.id];
  if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
  if (req.query.order_id) { where.push('order_id = ?'); params.push(String(req.query.order_id)); }
  const rows = db.prepare(`SELECT * FROM payments WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ ok: true, payments: rows.map((p) => publicPayment(p)) });
});

module.exports = router;
