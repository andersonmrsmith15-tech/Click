const express = require('express');
const { db } = require('../db');
const { createMerchant, publicMerchant } = require('../merchants');
const { ApiError, sha256, randomKey, toTiyin, toSum, maskCard } = require('../utils');
const svc = require('../services/cards');

const router = express.Router();

const CARD_SELECT = `SELECT c.*, m.name AS merchant_name FROM cards c LEFT JOIN merchants m ON m.id = c.created_by`;

function getCard(token) {
  const c = db.prepare(`${CARD_SELECT} WHERE c.token = ?`).get(String(token));
  if (!c) throw new ApiError(404, 'CARD_NOT_FOUND', 'Karta topilmadi');
  return c;
}

// ---------- Statistika ----------
router.get('/stats', (_req, res) => {
  const cards = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(balance),0) total,
                            SUM(status='active') active, SUM(status='blocked') blocked FROM cards`).get();
  const pays = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='completed' THEN amount END),0) volume,
                           SUM(status='completed') completed, SUM(status='pending') pending,
                           SUM(status='failed') failed, SUM(status='refunded') refunded FROM payments`).get();
  const today = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) volume FROM payments
                            WHERE status='completed' AND completed_at >= ?`).get(new Date().toISOString().slice(0, 10));
  const merchants = db.prepare('SELECT COUNT(*) n FROM merchants').get().n;
  res.json({
    ok: true,
    stats: {
      cards: { total: cards.n, active: cards.active || 0, blocked: cards.blocked || 0, total_balance: toSum(cards.total) },
      payments: {
        total: pays.n, completed: pays.completed || 0, pending: pays.pending || 0, failed: pays.failed || 0,
        refunded: pays.refunded || 0, volume: toSum(pays.volume),
      },
      today: { count: today.n, volume: toSum(today.volume) },
      merchants,
    },
  });
});

// ---------- Kartalar ----------
router.get('/cards', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.q) {
    const q = `%${String(req.query.q).replace(/\s/g, '')}%`;
    where.push('(c.number LIKE ? OR c.holder_name LIKE ? OR c.phone LIKE ? OR c.token LIKE ?)');
    params.push(q, `%${req.query.q}%`, q, q);
  }
  if (req.query.status) { where.push('c.status = ?'); params.push(String(req.query.status)); }
  if (req.query.merchant_id) { where.push('c.created_by = ?'); params.push(String(req.query.merchant_id)); }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM cards c ${w}`).get(...params).n;
  const rows = db.prepare(`${CARD_SELECT} ${w} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.json({ ok: true, total, cards: rows.map((c) => svc.publicCard(c, { full: true })) });
});

router.post('/cards', (req, res) => {
  const card = svc.createCard(req.body || {}, req.body?.merchant_id || null);
  res.status(201).json({ ok: true, card: svc.publicCard(getCard(card.token), { full: true }) });
});

router.get('/cards/:token', (req, res) => {
  const c = getCard(req.params.token);
  res.json({ ok: true, card: svc.publicCard(c, { full: true }), transactions: svc.listTransactions(c.id, 200) });
});

router.patch('/cards/:token', (req, res) => {
  const c = getCard(req.params.token);
  const { status, holder_name, phone, expiry } = req.body || {};
  svc.updateCard(c, { status, holder_name, phone, expiry });
  res.json({ ok: true, card: svc.publicCard(getCard(c.token), { full: true }) });
});

// { amount, action: "topup" | "withdraw" }
router.post('/cards/:token/balance', (req, res) => {
  const c = getCard(req.params.token);
  const action = req.body?.action || 'topup';
  if (!['topup', 'withdraw'].includes(action)) throw new ApiError(400, 'INVALID_ACTION', "action 'topup' yoki 'withdraw'");
  const amount = toTiyin(req.body?.amount);
  svc.adjustBalance(c.id, action === 'topup' ? amount : -amount, action === 'topup' ? 'topup' : 'withdraw');
  res.json({ ok: true, card: svc.publicCard(getCard(c.token), { full: true }) });
});

router.delete('/cards/:token', (req, res) => {
  const c = getCard(req.params.token);
  const used = db.prepare('SELECT COUNT(*) n FROM payments WHERE card_id = ?').get(c.id).n;
  if (used > 0) throw new ApiError(409, 'CARD_HAS_PAYMENTS', "Kartada to'lovlar bor — o'chirish o'rniga bloklang");
  db.prepare('DELETE FROM transactions WHERE card_id = ?').run(c.id);
  db.prepare('DELETE FROM cards WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---------- To'lovlar ----------
router.get('/payments', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('p.status = ?'); params.push(String(req.query.status)); }
  if (req.query.merchant_id) { where.push('p.merchant_id = ?'); params.push(String(req.query.merchant_id)); }
  if (req.query.card_token) { where.push('c.token = ?'); params.push(String(req.query.card_token)); }
  if (req.query.q) {
    where.push('(p.id LIKE ? OR p.order_id LIKE ? OR p.description LIKE ?)');
    const q = `%${req.query.q}%`; params.push(q, q, q);
  }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT p.*, c.number AS card_number, c.token AS card_token, m.name AS merchant_name
                           FROM payments p JOIN cards c ON c.id = p.card_id JOIN merchants m ON m.id = p.merchant_id
                           ${w} ORDER BY p.created_at DESC LIMIT ?`).all(...params, limit);
  res.json({
    ok: true,
    payments: rows.map((p) => ({
      payment_id: p.id, status: p.status, amount: toSum(p.amount), order_id: p.order_id, description: p.description,
      card_number: maskCard(p.card_number), card_token: p.card_token, merchant_id: p.merchant_id,
      merchant_name: p.merchant_name, error_code: p.error_code, created_at: p.created_at, completed_at: p.completed_at,
    })),
  });
});

// ---------- Merchantlar ----------
router.post('/merchants', (req, res) => {
  const { name, webhook_url = null } = req.body || {};
  if (!name || typeof name !== 'string') throw new ApiError(400, 'INVALID_NAME', 'name majburiy');
  if (webhook_url && !/^https?:\/\//.test(webhook_url)) throw new ApiError(400, 'INVALID_URL', "webhook_url http(s):// bilan boshlanishi kerak");
  res.status(201).json({ ok: true, merchant: createMerchant({ name, webhookUrl: webhook_url || null }) });
});

router.get('/merchants', (_req, res) => {
  const rows = db.prepare(`SELECT m.*,
      (SELECT COUNT(*) FROM cards WHERE created_by = m.id) AS cards_count,
      (SELECT COUNT(*) FROM payments WHERE merchant_id = m.id) AS payments_count,
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE merchant_id = m.id AND status='completed') AS volume
    FROM merchants m ORDER BY m.created_at DESC`).all();
  res.json({
    ok: true,
    merchants: rows.map((m) => ({ ...publicMerchant(m), cards_count: m.cards_count, payments_count: m.payments_count, volume: toSum(m.volume) })),
  });
});

router.patch('/merchants/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.params.id);
  if (!m) throw new ApiError(404, 'MERCHANT_NOT_FOUND', 'Merchant topilmadi');
  const webhookUrl = req.body?.webhook_url !== undefined ? req.body.webhook_url || null : m.webhook_url;
  const name = req.body?.name || m.name;
  if (webhookUrl && !/^https?:\/\//.test(webhookUrl)) throw new ApiError(400, 'INVALID_URL', "webhook_url http(s):// bilan boshlanishi kerak");
  db.prepare('UPDATE merchants SET webhook_url = ?, name = ? WHERE id = ?').run(webhookUrl, name, m.id);
  res.json({ ok: true, merchant: publicMerchant({ ...m, webhook_url: webhookUrl, name }) });
});

// API kalitni yangilash (eski kalit darhol ishlamay qoladi)
router.post('/merchants/:id/rotate-key', (req, res) => {
  const m = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.params.id);
  if (!m) throw new ApiError(404, 'MERCHANT_NOT_FOUND', 'Merchant topilmadi');
  const apiKey = randomKey('fcp_live');
  db.prepare('UPDATE merchants SET api_key_hash = ?, api_key_prefix = ? WHERE id = ?').run(sha256(apiKey), apiKey.slice(0, 14), m.id);
  res.json({ ok: true, api_key: apiKey, webhook_secret: m.webhook_secret });
});

module.exports = router;
