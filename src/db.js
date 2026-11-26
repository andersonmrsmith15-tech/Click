const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS merchants (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  api_key_hash   TEXT NOT NULL UNIQUE,
  api_key_prefix TEXT NOT NULL,
  webhook_url    TEXT,
  webhook_secret TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  number      TEXT NOT NULL UNIQUE,
  expiry      TEXT NOT NULL,
  holder_name TEXT,
  phone       TEXT,
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0), -- tiyinda
  currency    TEXT NOT NULL DEFAULT 'UZS',
  status      TEXT NOT NULL DEFAULT 'active',                  -- active | blocked
  created_by  TEXT REFERENCES merchants(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  merchant_id    TEXT NOT NULL REFERENCES merchants(id),
  card_id        TEXT NOT NULL REFERENCES cards(id),
  amount         INTEGER NOT NULL CHECK (amount > 0),         -- tiyinda
  status         TEXT NOT NULL,  -- pending | completed | failed | cancelled | expired | refunded
  order_id       TEXT,
  description    TEXT,
  otp_hash       TEXT,
  otp_expires_at TEXT,
  otp_attempts   INTEGER NOT NULL DEFAULT 0,
  error_code     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT,
  UNIQUE (merchant_id, order_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  card_id       TEXT NOT NULL REFERENCES cards(id),
  payment_id    TEXT REFERENCES payments(id),
  type          TEXT NOT NULL,   -- topup | debit | refund
  amount        INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tx_card ON transactions(card_id, created_at);
`);

/** fn ichidagi barcha so'rovlarni bitta tranzaksiyada bajaradi */
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, transaction };
