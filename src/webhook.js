const crypto = require('node:crypto');
const { db } = require('./db');

/**
 * To'lov holati o'zgarganda merchantning webhook_url manziliga POST yuboradi.
 * Imzo: X-Signature = HMAC-SHA256(webhook_secret, body) hex.
 * Xato bo'lsa 3 marta qayta urinadi (1s, 5s, 15s).
 */
function sendWebhook(merchantId, event, payload) {
  const merchant = db.prepare('SELECT webhook_url, webhook_secret FROM merchants WHERE id = ?').get(merchantId);
  if (!merchant || !merchant.webhook_url) return;

  const body = JSON.stringify({ event, data: payload, sent_at: new Date().toISOString() });
  const signature = crypto.createHmac('sha256', merchant.webhook_secret).update(body).digest('hex');
  const delays = [0, 1000, 5000, 15000];

  const attempt = async (i) => {
    try {
      const res = await fetch(merchant.webhook_url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': signature, 'x-event': event },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i + 1 < delays.length) setTimeout(() => attempt(i + 1), delays[i + 1]);
      else console.warn(`[webhook] ${merchant.webhook_url} ga yuborilmadi (${event}): ${err.message}`);
    }
  };
  attempt(0);
}

module.exports = { sendWebhook };
