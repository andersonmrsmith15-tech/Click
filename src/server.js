const config = require('./config');
const { db } = require('./db');
const { createMerchant } = require('./merchants');
const app = require('./app');

// Birinchi ishga tushishda default merchant yaratiladi
const count = db.prepare('SELECT COUNT(*) AS n FROM merchants').get().n;
if (count === 0) {
  const m = createMerchant({ name: 'Default merchant' });
  console.log('\n=== Birinchi ishga tushirish: default merchant yaratildi ===');
  console.log(`  merchant_id    : ${m.id}`);
  console.log(`  api_key        : ${m.api_key}`);
  console.log(`  webhook_secret : ${m.webhook_secret}`);
  console.log("  (api_key'ni saqlab qo'ying — u boshqa ko'rsatilmaydi)\n");
}

app.listen(config.port, () => {
  console.log(`Fake Click Pay API: http://localhost:${config.port}  (DEMO_MODE=${config.demoMode})`);
});
