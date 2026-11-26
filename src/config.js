const path = require('node:path');
const fs = require('node:fs');

// .env faylini yuklash (Node 21.7+ o'rnatilgan imkoniyati)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

module.exports = {
  port: Number(process.env.PORT || 4000),
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'clickpay.db'),
  // Admin endpointlari uchun kalit (merchant yaratish va h.k.)
  adminKey: process.env.ADMIN_KEY || 'admin-secret-change-me',
  // DEMO_MODE=true bo'lsa, SMS o'rniga OTP kod javobda qaytariladi
  demoMode: (process.env.DEMO_MODE || 'true') === 'true',
  otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS || 300),
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 3),
};
