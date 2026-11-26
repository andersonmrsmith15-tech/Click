# Fake Click Pay

Click'ga o'xshash, **fake karta hisobidan pul yechadigan** kichik to'lov tizimi. Uni boshqa loyihalar tashqi REST API sifatida chaqiradi.

> Bu tizim test va o'quv uchun. Haqiqiy kartalar bilan ishlamaydi.

## Ishga tushirish

```bash
npm install
npm start
```

Sozlamalar `.env` faylidan o'qiladi (namuna: `.env.example`). Admin panel kaliti `ADMIN_KEY` qiymatida.

## Web admin panel

**http://localhost:4000/admin** sahifasini oching va `ADMIN_KEY` bilan kiring. Panelda quyidagilar bor:

- **Boshqaruv:** kartalar soni, jami balans, to'lovlar aylanmasi, bugungi to'lovlar va so'nggi to'lovlar.
- **Kartalar:** fake karta qo'shish (tasodifiy raqam generatori bilan), qidirish va filtrlash. Kartani bosganda uning tafsilotlari ochiladi: balansni to'ldirish yoki yechish, tahrirlash, bloklash yoki blokdan chiqarish, o'chirish va harakatlar tarixi.
- **To'lovlar:** barcha to'lovlar ro'yxati, holat, merchant va matn bo'yicha filtr.
- **Merchantlar:** yangi loyiha uchun API kalit yaratish, webhook URL'ni o'zgartirish, kalitni yangilash.

Panel ishlatadigan admin API (`X-Admin-Key` header'i bilan): `GET /admin/stats`, `GET|POST /admin/cards`, `GET|PATCH|DELETE /admin/cards/:token`, `POST /admin/cards/:token/balance` (tana: `{action:"topup"|"withdraw", amount}`), `GET /admin/payments`, `GET|POST /admin/merchants`, `PATCH /admin/merchants/:id`, `POST /admin/merchants/:id/rotate-key`.

Birinchi ishga tushirishda konsolga **default merchant**ning `api_key` va `webhook_secret` qiymatlari chiqadi. Ularni saqlab qo'ying, chunki ular qayta ko'rsatilmaydi.

Har bir tashqi loyiha uchun alohida kalit yaratish mumkin:

```bash
npm run create-merchant -- "Mening do'konim" http://localhost:3000/clickpay/webhook
# yoki API orqali:
curl -X POST http://localhost:4000/api/v1/admin/merchants \
  -H "X-Admin-Key: mening-maxfiy-kalitim" -H "Content-Type: application/json" \
  -d '{"name":"Mening do'\''konim","webhook_url":"http://localhost:3000/clickpay/webhook"}'
```

Sozlamalar (env): `PORT` (4000), `ADMIN_KEY`, `DEMO_MODE` (true), `OTP_TTL_SECONDS` (300), `OTP_MAX_ATTEMPTS` (3), `DB_FILE`.

## Qanday ishlaydi

1. Tashqi tizim fake kartani qo'shadi: karta raqami, muddati va balansi.
2. To'lov yaratiladi. Shu paytda karta tekshiriladi va 6 xonali OTP kod chiqariladi.
3. OTP bilan tasdiqlanganda pul kartadan yechiladi.
4. Holat o'zgarganda merchantning `webhook_url` manziliga xabar yuboriladi.

`DEMO_MODE=true` bo'lsa, SMS yuborilmaydi va OTP kod to'g'ridan-to'g'ri javobdagi `otp_code` maydonida qaytadi.

To'lov holatlari: `pending` → `completed` | `failed` | `cancelled` | `expired`; `completed` → `refunded`.

## Autentifikatsiya

Har bir so'rovga quyidagi header'lardan biri qo'shiladi:
`X-API-Key: fcp_live_...` yoki `Authorization: Bearer fcp_live_...`.

Summalar **so'mda** beriladi (ko'pi bilan 2 xona kasr). Ichkarida ular tiyinda butun son sifatida saqlanadi.

## API (`/api/v1`)

### Kartalar
| Metod | Yo'l | Tana | Izoh |
|---|---|---|---|
| POST | `/cards` | `{card_number, expiry:"MM/YY", balance, holder_name?, phone?}` | Fake karta qo'shadi va `card_token` qaytaradi |
| GET | `/cards` | | O'zingiz qo'shgan kartalar |
| GET | `/cards/:token` | | Karta ma'lumoti va balansi |
| POST | `/cards/:token/topup` | `{amount}` | Balansni to'ldiradi |
| PATCH | `/cards/:token` | `{status:"active"\|"blocked", holder_name?, phone?}` | Kartani bloklaydi yoki ma'lumotini o'zgartiradi |
| GET | `/cards/:token/transactions` | | Kartadagi harakatlar tarixi |

### To'lovlar
| Metod | Yo'l | Tana | Izoh |
|---|---|---|---|
| POST | `/payments` | `{card_number, expiry}` yoki `{card_token}`, `amount`, `order_id?`, `description?`, `auto_confirm?` | To'lov yaratadi. Natija `pending` holatda bo'ladi va OTP chiqariladi |
| POST | `/payments/:id/confirm` | `{otp}` | Tasdiqlaydi va pulni yechadi |
| POST | `/payments/:id/resend-otp` | | Yangi OTP chiqaradi |
| POST | `/payments/:id/cancel` | | `pending` to'lovni bekor qiladi, `completed` to'lovning pulini kartaga qaytaradi |
| GET | `/payments/:id` | | To'lov holatini ko'rsatadi |
| GET | `/payments?status=&order_id=&limit=&offset=` | | To'lovlar ro'yxati |

- `auto_confirm: true` faqat `card_token` bilan ishlaydi: pul OTP'siz darhol yechiladi. Bu obuna yoki saqlangan karta bilan to'lash uchun.
- **Idempotentlik:** bir xil `order_id` qayta yuborilsa, yangi to'lov yaratilmaydi va mavjudi qaytariladi. Summa boshqacha bo'lsa, `409 ORDER_ID_CONFLICT` qaytadi.

### Xatolar
Xato javobining formati: `{"ok":false,"error":{"code":"...","message":"..."}}`

| Kod | HTTP | Ma'nosi |
|---|---|---|
| `INSUFFICIENT_FUNDS` | 402 | Kartada mablag' yetarli emas |
| `CARD_NOT_FOUND` | 404 | Karta topilmadi yoki muddati noto'g'ri |
| `CARD_BLOCKED` | 403 | Karta bloklangan |
| `INVALID_OTP` | 400 | OTP kod noto'g'ri |
| `OTP_ATTEMPTS_EXCEEDED` | 403 | Urinishlar tugadi, to'lov `failed` holatiga o'tdi |
| `OTP_EXPIRED` | 410 | OTP kod muddati o'tgan |
| `CARD_EXISTS` | 409 | Bu karta raqami allaqachon qo'shilgan |
| `INVALID_STATE` | 409 | Bu amalni to'lovning hozirgi holatida bajarib bo'lmaydi |
| `UNAUTHORIZED` | 401 | API kalit noto'g'ri |

## curl misoli

```bash
K=fcp_live_...; B=http://localhost:4000/api/v1

# 1) karta qo'shish
curl -X POST $B/cards -H "X-API-Key: $K" -H "Content-Type: application/json" \
  -d '{"card_number":"8600 1234 5678 9012","expiry":"12/29","balance":500000}'

# 2) to'lov yaratish -> javobda payment_id va otp_code bo'ladi
curl -X POST $B/payments -H "X-API-Key: $K" -H "Content-Type: application/json" \
  -d '{"card_number":"8600123456789012","expiry":"12/29","amount":125000,"order_id":"order-1"}'

# 3) tasdiqlash
curl -X POST $B/payments/pay_xxx/confirm -H "X-API-Key: $K" -H "Content-Type: application/json" \
  -d '{"otp":"123456"}'
```

## Boshqa loyihada ishlatish (SDK)

[sdk/clickpay-client.js](sdk/clickpay-client.js) faylini loyihangizga ko'chiring. U Node 18+ da ishlaydi va tashqi kutubxonalar talab qilmaydi.

```js
const ClickPay = require('./clickpay-client');
const pay = new ClickPay({ baseUrl: 'http://localhost:4000', apiKey: process.env.CLICKPAY_KEY });

const card = await pay.createCard({ card_number: '8600123456789012', expiry: '12/29', balance: 500000 });

const { payment, otp_code } = await pay.createPayment({
  card_number: '8600123456789012', expiry: '12/29', amount: 125000, order_id: 'order-1',
});
const done = await pay.confirmPayment(payment.payment_id, otp_code); // foydalanuvchi kiritgan kod
console.log(done.status); // "completed"

// Saqlangan token bilan OTP'siz to'lov
await pay.charge({ card_token: card.card_token, amount: 25000 });
```

To'liq namunani ishga tushirish: `API_KEY=fcp_live_... npm run demo`

## Webhook

Har bir holat o'zgarishida (`payment.completed`, `payment.failed`, `payment.cancelled`, `payment.refunded`, `payment.expired`) quyidagi POST so'rov yuboriladi:

```json
{ "event": "payment.completed", "data": { "payment_id": "...", "status": "completed", ... }, "sent_at": "..." }
```

`X-Signature` header'i so'rov tanasining `HMAC-SHA256(webhook_secret, body)` imzosini o'z ichiga oladi. Uni quyidagicha tekshiring:

```js
app.post('/clickpay/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!ClickPay.verifyWebhook(req.body.toString(), req.get('x-signature'), WEBHOOK_SECRET)) return res.sendStatus(401);
  const { event, data } = JSON.parse(req.body);
  // buyurtma holatini yangilang...
  res.sendStatus(200);
});
```

Xato bo'lsa, so'rov 3 marta qayta yuboriladi (1s, 5s va 15s dan keyin).

## Tuzilma
```
src/server.js         ishga tushirish va default merchant
src/app.js            Express ilovasi va marshrutlar
src/db.js             SQLite (node:sqlite) sxemasi
src/routes/cards.js   kartalar API
src/routes/payments.js to'lovlar API (OTP, yechish, qaytarish)
src/routes/admin.js   admin API (kartalar, to'lovlar, merchantlar)
src/services/cards.js karta logikasi (umumiy)
public/admin/         web admin panel (HTML/CSS/JS)
src/webhook.js        imzolangan webhooklar
sdk/clickpay-client.js tashqi loyihalar uchun mijoz
examples/demo.js      to'liq oqim namunasi
```
