// To'liq oqim namunasi.  Foydalanish:  API_KEY=fcp_live_... npm run demo
const ClickPay = require('../sdk/clickpay-client');

const pay = new ClickPay({ baseUrl: process.env.BASE_URL || 'http://localhost:4000', apiKey: process.env.API_KEY });
const rand16 = () => '8600' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0');

(async () => {
  // 1. Fake karta qo'shish (balans 500 000 so'm)
  const cardNumber = rand16();
  const card = await pay.createCard({ card_number: cardNumber, expiry: '12/29', balance: 500000, holder_name: 'Test User' });
  console.log('Karta:', card.card_number, 'balans:', card.balance);

  // 2. To'lov yaratish (karta raqami + muddat) -> OTP
  const { payment, otp_code } = await pay.createPayment({
    card_number: cardNumber,
    expiry: '12/29',
    amount: 125000,
    order_id: 'order-' + Date.now(),
    description: 'Buyurtma #1',
  });
  console.log("To'lov yaratildi:", payment.payment_id, payment.status, 'OTP:', otp_code);

  // 3. OTP bilan tasdiqlash -> pul yechiladi
  const confirmed = await pay.confirmPayment(payment.payment_id, otp_code);
  console.log('Tasdiqlandi:', confirmed.status);
  console.log('Yangi balans:', (await pay.getCard(card.card_token)).balance);

  // 4. Tokendan OTP'siz darhol yechish
  const quick = await pay.charge({ card_token: card.card_token, amount: 25000, description: 'Obuna' });
  console.log('Tezkor to\'lov:', quick.status, '| balans:', (await pay.getCard(card.card_token)).balance);

  // 5. Mablag' yetarli emas holati
  try {
    await pay.charge({ card_token: card.card_token, amount: 10_000_000 });
  } catch (e) {
    console.log('Kutilgan xato:', e.code, '-', e.message);
  }

  // 6. Qaytarish (refund)
  const refunded = await pay.cancelPayment(quick.payment_id);
  console.log('Qaytarildi:', refunded.status, '| balans:', (await pay.getCard(card.card_token)).balance);

  console.log('\nTarix:', await pay.cardTransactions(card.card_token));
})().catch((e) => { console.error('Xato:', e.code || '', e.message); process.exit(1); });
