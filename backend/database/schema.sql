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
