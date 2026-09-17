-- ANONYMIKECONNECT / SUPA LAN Phase 1 schema
-- PostgreSQL/Supabase compatible SQL

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  duration TEXT NOT NULL,
  bandwidth TEXT NOT NULL,
  data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  package_id TEXT NOT NULL REFERENCES packages(id),
  amount INTEGER NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  payment_provider TEXT NOT NULL DEFAULT 'TEST',
  provider_transaction_id TEXT,
  provider_request_id TEXT,
  provider_checkout_id TEXT,
  mpesa_receipt TEXT,
  voucher_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  package_id TEXT NOT NULL REFERENCES packages(id),
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  order_id UUID REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_request_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_checkout_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mpesa_receipt TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_reference ON orders(reference);
CREATE INDEX IF NOT EXISTS idx_orders_package ON orders(package_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status, package_id);

CREATE TABLE IF NOT EXISTS sms_messages (
  id BIGSERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'MANUAL',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  provider TEXT NOT NULL DEFAULT 'TextSMS',
  provider_message_id TEXT,
  event_key TEXT,
  network TEXT,
  error_code TEXT,
  error_message TEXT,
  created_by TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_created_at ON sms_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_status ON sms_messages(status);
CREATE INDEX IF NOT EXISTS idx_sms_messages_type ON sms_messages(message_type);
CREATE INDEX IF NOT EXISTS idx_sms_messages_recipient ON sms_messages(recipient);
CREATE INDEX IF NOT EXISTS idx_sms_messages_provider_id ON sms_messages(provider_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sms_messages_event_key ON sms_messages(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS sms_automation_settings (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sms_automation_settings (key, enabled)
VALUES ('master', FALSE)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS sms_message_templates (
  message_type TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO sms_message_templates (message_type, template, updated_by)
VALUES ('PURCHASE_CONFIRMATION', 'SUPA LAN payment confirmed. Voucher: {{voucher}}. Package: {{package}}{{duration}}. Connect to SUPA LAN and enter your voucher.', 'system')
ON CONFLICT (message_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS free_access_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  active_voucher VARCHAR(5) NOT NULL CHECK (active_voucher IN ('RYRNN', 'KSSSS')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'system'
);
INSERT INTO free_access_settings (id, enabled, active_voucher) VALUES (TRUE, FALSE, 'KSSSS') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS free_access_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone VARCHAR(16) NOT NULL,
  voucher VARCHAR(5) NOT NULL CHECK (voucher IN ('RYRNN', 'KSSSS')),
  expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, event_key TEXT UNIQUE,
  session_mac TEXT, session_account_id INTEGER, session_start_time TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS free_access_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token_hash TEXT NOT NULL UNIQUE,
  phone VARCHAR(16) NOT NULL, voucher VARCHAR(5) NOT NULL CHECK (voucher IN ('RYRNN', 'KSSSS')),
  session_mac TEXT NOT NULL, account_id INTEGER, start_time TEXT,
  expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
  event_key TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_free_access_challenges_match ON free_access_challenges (voucher, session_mac, expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS ix_free_access_challenges_session_tuple ON free_access_challenges (token_hash, voucher, session_mac, account_id, start_time, expires_at, consumed_at);
INSERT INTO sms_message_templates (message_type, template, updated_by) VALUES ('FREE_ACCESS', 'SUPA LAN: Your 7-minute free access is now active! Voucher: {{voucher}}. Enjoy your connection. For unlimited premium packages, visit {{portal_url}}. Support: {{support}}', 'system') ON CONFLICT (message_type) DO NOTHING;
