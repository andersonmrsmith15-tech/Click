const express = require('express');
const { db } = require('../db');
const { ApiError, toTiyin } = require('../utils');
const svc = require('../services/cards');

const router = express.Router();

/** Merchant faqat o'zi qo'shgan kartani boshqara oladi */
function getOwnCard(req) {
  const card = svc.findByToken(req.params.token);
  if (!card || card.created_by !== req.merchant.id) throw new ApiError(404, 'CARD_NOT_FOUND', 'Karta topilmadi');
  return card;
}

router.post('/', (req, res) => {
  const card = svc.createCard(req.body || {}, req.merchant.id);
  res.status(201).json({ ok: true, card: svc.publicCard(card) });
});

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = db.prepare('SELECT * FROM cards WHERE created_by = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(req.merchant.id, limit, offset);
  res.json({ ok: true, cards: rows.map((c) => svc.publicCard(c)) });
});

router.get('/:token', (req, res) => res.json({ ok: true, card: svc.publicCard(getOwnCard(req)) }));

router.post('/:token/topup', (req, res) => {
  const c = getOwnCard(req);
  res.json({ ok: true, card: svc.publicCard(svc.adjustBalance(c.id, toTiyin(req.body?.amount))) });
});

router.patch('/:token', (req, res) => {
  const { status, holder_name, phone } = req.body || {};
  res.json({ ok: true, card: svc.publicCard(svc.updateCard(getOwnCard(req), { status, holder_name, phone })) });
});

router.get('/:token/transactions', (req, res) => {
  res.json({ ok: true, transactions: svc.listTransactions(getOwnCard(req).id, req.query.limit) });
});

module.exports = router;
