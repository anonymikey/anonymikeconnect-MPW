-- Additive SUPA LAN catalog expansion.
-- Existing package rows, prices, names, orders, and vouchers are intentionally untouched.
-- The unique IDs make this migration safe to run more than once.

INSERT INTO packages (id, name, price, duration, bandwidth, data)
VALUES
  ('hours_1', '1 Hour Unlimited', 5, '1 hour', 'unlimited', 'unlimited'),
  ('hours_3', '3 Hours Unlimited', 8, '3 hours', 'unlimited', 'unlimited'),
  ('hours_5', '5 Hours Unlimited', 10, '5 hours', 'unlimited', 'unlimited'),
  ('hours_6', '6 Hours Unlimited', 15, '6 hours', 'unlimited', 'unlimited'),
  ('hours_12', '12 Hours Unlimited', 20, '12 hours', 'unlimited', 'unlimited'),
  ('hours_24', '24 Hours Unlimited', 30, '24 hours', 'unlimited', 'unlimited'),
  ('days_2', '2 Days Unlimited', 50, '2 days', 'unlimited', 'unlimited'),
  ('days_30_450', '30 Days Unlimited', 450, '30 days', 'unlimited', 'unlimited'),
  ('data_100gb_30d', '100 GB Data Plan', 400, '30 days', 'limited', '100 GB')
ON CONFLICT (id) DO NOTHING;

-- Preserve the requested customer-facing labels where the deployed schema supports them.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS label TEXT;

UPDATE packages SET label = 'MOST POPULAR' WHERE id = 'hours_24' AND (label IS NULL OR label = '');
UPDATE packages SET label = 'MONTHLY UNLIMITED' WHERE id = 'days_30_450' AND (label IS NULL OR label = '');
UPDATE packages SET label = 'DATA PLAN' WHERE id = 'data_100gb_30d' AND (label IS NULL OR label = '');

-- IDs are the existing package identity and primary key; no uniqueness constraint is
-- added across names because historical catalog rows must remain untouched.
