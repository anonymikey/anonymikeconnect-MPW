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

CREATE INDEX IF NOT EXISTS idx_orders_reference ON orders(reference);
CREATE INDEX IF NOT EXISTS idx_orders_package ON orders(package_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status, package_id);
