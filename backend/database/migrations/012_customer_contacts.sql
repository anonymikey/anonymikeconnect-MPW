-- Stage 1 customer/contact foundation. Additive and safe to run once.
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customers_phone_unique UNIQUE (phone)
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE expiry_records ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_expiry_records_customer_id ON expiry_records(customer_id);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_service_role_only ON customers;
CREATE POLICY customers_service_role_only ON customers USING (false) WITH CHECK (false);

-- Backfill only from already reliable order phone values; no expiry rows are guessed.
INSERT INTO customers (phone)
SELECT DISTINCT phone FROM orders WHERE phone IS NOT NULL AND btrim(phone) <> ''
ON CONFLICT (phone) DO NOTHING;
UPDATE orders o SET customer_id = c.id
FROM customers c WHERE o.customer_id IS NULL AND c.phone = o.phone;
UPDATE expiry_records e SET customer_id = o.customer_id
FROM orders o WHERE e.customer_id IS NULL AND e.order_id = o.id AND o.customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION set_customers_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_customers_updated_at();

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
