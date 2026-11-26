const { db, transaction } = require('../db');
const {
  ApiError, id, now, randomKey, toTiyin, toSum, normalizeCardNumber, normalizeExpiry, maskCard,
} = require('../utils');

function publicCard(c, { full = false } = {}) {
  return {
    card_token: c.token,
    card_number: full ? c.number : maskCard(c.number),
    expiry: c.expiry,
    holder_name: c.holder_name,
    phone: c.phone,
    balance: toSum(c.balance),
    currency: c.currency,
    status: c.status,
    ...(full ? { created_by: c.created_by, merchant_name: c.merchant_name ?? null } : {}),
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

const findByToken = (token) => db.prepare('SELECT * FROM cards WHERE token = ?').get(String(token));

function createCard({ card_number, expiry, holder_name = null, phone = null, balance = 0 }, createdBy) {
  const number = normalizeCardNumber(card_number);
  const exp = normalizeExpiry(expiry);
  const bal = balance === 0 || balance === '0' || balance === '' || balance == null ? 0 : toTiyin(balance, 'balance');
  if (db.prepare('SELECT 1 FROM cards WHERE number = ?').get(number)) {
    throw new ApiError(409, 'CARD_EXISTS', "Bu karta raqami allaqachon ro'yxatdan o'tgan");
  }
  if (createdBy && !db.prepare('SELECT 1 FROM merchants WHERE id = ?').get(createdBy)) {
    throw new ApiError(400, 'MERCHANT_NOT_FOUND', 'Merchant topilmadi');
  }
  const ts = now();
  const card = {
    id: id('card'), token: randomKey('ctok', 16), number, expiry: exp,
    holder_name: holder_name || null, phone: phone || null, balance: bal, currency: 'UZS', status: 'active',
    created_by: createdBy || null, created_at: ts, updated_at: ts,
  };
  transaction(() => {
    db.prepare(`INSERT INTO cards (id, token, number, expiry, holder_name, phone, balance, currency, status, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(card.id, card.token, card.number, card.expiry, card.holder_name, card.phone, card.balance,
           card.currency, card.status, card.created_by, card.created_at, card.updated_at);
    if (bal > 0) {
      db.prepare(`INSERT INTO transactions (id, card_id, payment_id, type, amount, balance_after, created_at)
                  VALUES (?, ?, NULL, 'topup', ?, ?, ?)`).run(id('tx'), card.id, bal, bal, ts);
    }
  });
  return card;
}

/** amount > 0 -> to'ldirish, amount < 0 (faqat admin) -> qo'lda yechish */
function adjustBalance(cardId, amountTiyin, type = 'topup') {
  return transaction(() => {
    const c = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
    const newBalance = c.balance + amountTiyin;
    if (newBalance < 0) throw new ApiError(402, 'INSUFFICIENT_FUNDS', "Kartada mablag' yetarli emas");
    const ts = now();
    db.prepare('UPDATE cards SET balance = ?, updated_at = ? WHERE id = ?').run(newBalance, ts, c.id);
    db.prepare(`INSERT INTO transactions (id, card_id, payment_id, type, amount, balance_after, created_at)
                VALUES (?, ?, NULL, ?, ?, ?, ?)`).run(id('tx'), c.id, type, amountTiyin, newBalance, ts);
    return { ...c, balance: newBalance, updated_at: ts };
  });
}

function updateCard(c, { status, holder_name, phone, expiry }) {
  if (status !== undefined && !['active', 'blocked'].includes(status)) {
    throw new ApiError(400, 'INVALID_STATUS', "status 'active' yoki 'blocked' bo'lishi kerak");
  }
  const updated = {
    ...c,
    status: status ?? c.status,
    holder_name: holder_name !== undefined ? holder_name || null : c.holder_name,
    phone: phone !== undefined ? phone || null : c.phone,
    expiry: expiry !== undefined ? normalizeExpiry(expiry) : c.expiry,
    updated_at: now(),
  };
  db.prepare('UPDATE cards SET status = ?, holder_name = ?, phone = ?, expiry = ?, updated_at = ? WHERE id = ?')
    .run(updated.status, updated.holder_name, updated.phone, updated.expiry, updated.updated_at, c.id);
  return updated;
}

function listTransactions(cardId, limit = 50) {
  return db.prepare('SELECT * FROM transactions WHERE card_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(cardId, Math.min(Number(limit) || 50, 500))
    .map((t) => ({
      id: t.id, type: t.type, amount: toSum(t.amount), balance_after: toSum(t.balance_after),
      payment_id: t.payment_id, created_at: t.created_at,
    }));
}

module.exports = { publicCard, findByToken, createCard, adjustBalance, updateCard, listTransactions, toTiyin };
