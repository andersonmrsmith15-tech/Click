const path = require('node:path');
const express = require('express');
const { requireMerchant, requireAdmin, errorHandler } = require('./middleware');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Boshqa domenlardagi frontendlardan ham chaqirish mumkin bo'lishi uchun CORS
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization, X-Admin-Key');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Web admin panel: http://localhost:4000/admin
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.get('/', (_req, res) => res.redirect('/admin'));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'fake-click-pay' }));

app.use('/api/v1/admin', requireAdmin, require('./routes/admin'));
app.use('/api/v1/cards', requireMerchant, require('./routes/cards'));
app.use('/api/v1/payments', requireMerchant, require('./routes/payments'));

app.use((_req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint topilmadi' } }));
app.use(errorHandler);

module.exports = app;
