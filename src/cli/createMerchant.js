// Foydalanish: npm run create-merchant -- "Do'kon nomi" [webhook_url]
const { createMerchant } = require('../merchants');

const [name, webhookUrl] = process.argv.slice(2);
if (!name) {
  console.error('Foydalanish: npm run create-merchant -- "Nomi" [webhook_url]');
  process.exit(1);
}
const m = createMerchant({ name, webhookUrl: webhookUrl || null });
console.log(JSON.stringify(m, null, 2));
