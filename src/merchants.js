const { db } = require('./db');
const { id, now, sha256, randomKey } = require('./utils');

function createMerchant({ name, webhookUrl = null }) {
  const apiKey = randomKey('fcp_live');
  const merchant = {
    id: id('mer'),
    name,
    api_key_hash: sha256(apiKey),
    api_key_prefix: apiKey.slice(0, 14),
    webhook_url: webhookUrl,
    webhook_secret: randomKey('whsec', 16),
    created_at: now(),
  };
  db.prepare(`INSERT INTO merchants (id, name, api_key_hash, api_key_prefix, webhook_url, webhook_secret, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(merchant.id, merchant.name, merchant.api_key_hash, merchant.api_key_prefix,
         merchant.webhook_url, merchant.webhook_secret, merchant.created_at);
  return { ...publicMerchant(merchant), api_key: apiKey, webhook_secret: merchant.webhook_secret };
}

function findByApiKey(apiKey) {
  return db.prepare('SELECT * FROM merchants WHERE api_key_hash = ?').get(sha256(apiKey));
}

function publicMerchant(m) {
  return {
    id: m.id,
    name: m.name,
    api_key_prefix: m.api_key_prefix,
    webhook_url: m.webhook_url,
    created_at: m.created_at,
  };
}

module.exports = { createMerchant, findByApiKey, publicMerchant };
