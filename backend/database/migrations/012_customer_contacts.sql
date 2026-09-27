CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE expiry_records
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_expiry_records_customer_id ON expiry_records(customer_id);

UPDATE expiry_records r
SET customer_id = c.id
FROM customers c
WHERE r.customer_id IS NULL
  AND r.customer_phone IS NOT NULL
  AND r.customer_phone = c.phone;

UPDATE orders o
SET customer_id = c.id
FROM customers c
WHERE o.customer_id IS NULL
  AND o.phone IS NOT NULL
  AND o.phone = c.phone;

INSERT INTO customers (phone)
SELECT DISTINCT phone
FROM (
  SELECT customer_phone AS phone FROM expiry_records WHERE customer_phone IS NOT NULL AND customer_phone <> ''
  UNION
  SELECT phone FROM orders WHERE phone IS NOT NULL AND phone <> ''
) existing
WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.phone = existing.phone);

UPDATE expiry_records r
SET customer_id = c.id
FROM customers c
WHERE r.customer_id IS NULL AND r.customer_phone = c.phone;

UPDATE orders o
SET customer_id = c.id
FROM customers c
WHERE o.customer_id IS NULL AND o.phone = c.phone;

CREATE OR REPLACE FUNCTION set_customer_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_updated_at ON customers;
CREATE TRIGGER customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION set_customer_updated_at();

CREATE INDEX IF NOT EXISTS idx_customers_phone_lookup ON customers(phone);
