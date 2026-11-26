/**
 * Fake Click Pay — boshqa loyihalar uchun mijoz (SDK).
 * Bu faylni o'z loyihangizga ko'chiring (Node 18+ yoki brauzer, tashqi kutubxonasiz).
 *
 *   const ClickPay = require('./clickpay-client');
 *   const pay = new ClickPay({ baseUrl: 'http://localhost:4000', apiKey: 'fcp_live_...' });
 */
class ClickPayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ClickPayError';
    this.status = status;
    this.code = code;
  }
}

class ClickPay {
  constructor({ baseUrl = 'http://localhost:4000', apiKey, timeoutMs = 10000 }) {
    if (!apiKey) throw new Error('apiKey majburiy');
    this.baseUrl = baseUrl.replace(/\/$/, '') + '/api/v1';
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async _req(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const e = data.error || {};
      throw new ClickPayError(res.status, e.code || 'HTTP_ERROR', e.message || `HTTP ${res.status}`);
    }
    return data;
  }

  // ---- Kartalar ----
  createCard({ card_number, expiry, balance = 0, holder_name, phone }) {
    return this._req('POST', '/cards', { card_number, expiry, balance, holder_name, phone }).then((d) => d.card);
  }
  getCard(cardToken) { return this._req('GET', `/cards/${cardToken}`).then((d) => d.card); }
  listCards() { return this._req('GET', '/cards').then((d) => d.cards); }
  topup(cardToken, amount) { return this._req('POST', `/cards/${cardToken}/topup`, { amount }).then((d) => d.card); }
  setCardStatus(cardToken, status) { return this._req('PATCH', `/cards/${cardToken}`, { status }).then((d) => d.card); }
  cardTransactions(cardToken) { return this._req('GET', `/cards/${cardToken}/transactions`).then((d) => d.transactions); }

  // ---- To'lovlar ----
  /** { card_number, expiry } yoki { card_token }, amount, order_id?, description?, auto_confirm? */
  createPayment(params) { return this._req('POST', '/payments', params); }
  confirmPayment(paymentId, otp) { return this._req('POST', `/payments/${paymentId}/confirm`, { otp }).then((d) => d.payment); }
  resendOtp(paymentId) { return this._req('POST', `/payments/${paymentId}/resend-otp`); }
  cancelPayment(paymentId) { return this._req('POST', `/payments/${paymentId}/cancel`).then((d) => d.payment); }
  getPayment(paymentId) { return this._req('GET', `/payments/${paymentId}`).then((d) => d.payment); }
  listPayments(query = {}) {
    const qs = new URLSearchParams(query).toString();
    return this._req('GET', `/payments${qs ? '?' + qs : ''}`).then((d) => d.payments);
  }

  /** Tokenli kartadan OTP'siz darhol yechish */
  charge({ card_token, amount, order_id, description }) {
    return this._req('POST', '/payments', { card_token, amount, order_id, description, auto_confirm: true })
      .then((d) => d.payment);
  }

  /** Webhook imzosini tekshirish (faqat Node.js) */
  static verifyWebhook(rawBody, signature, webhookSecret) {
    const crypto = require('node:crypto');
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return typeof signature === 'string' && signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}

ClickPay.ClickPayError = ClickPayError;
module.exports = ClickPay;
