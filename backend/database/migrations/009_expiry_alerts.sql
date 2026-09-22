CREATE TABLE IF NOT EXISTS expiry_records (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  order_reference TEXT NOT NULL UNIQUE,
  voucher_code TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  package_name TEXT NOT NULL,
  package_price INTEGER NOT NULL DEFAULT 0,
  duration_value INTEGER NOT NULL,
  duration_unit TEXT NOT NULL CHECK (duration_unit IN ('minutes','hours','days')),
  purchased_at TIMESTAMPTZ NOT NULL,
  activation_reference_at TIMESTAMPTZ NOT NULL,
  expected_expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRING_SOON','EXPIRED','CANCELLED','COMPLETED')),
  alerts_cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expiry_records_status_expiry ON expiry_records(status, expected_expires_at);

CREATE TABLE IF NOT EXISTS expiry_rules (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  offset_minutes INTEGER NOT NULL CHECK (offset_minutes >= 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('EXPIRY_REMINDER','EXPIRY_FINAL_REMINDER','EXPIRY_EXPIRED')),
  enabled BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_expiry_rules_offset_type ON expiry_rules(offset_minutes, event_type);
INSERT INTO expiry_rules (name, offset_minutes, event_type, enabled, sort_order) VALUES
 ('60 minutes before expiry', 60, 'EXPIRY_REMINDER', true, 1),
 ('30 minutes before expiry', 30, 'EXPIRY_FINAL_REMINDER', false, 2),
 ('15 minutes before expiry', 15, 'EXPIRY_FINAL_REMINDER', false, 3),
 ('At expiry', 0, 'EXPIRY_EXPIRED', true, 4)
ON CONFLICT (offset_minutes, event_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS expiry_events (
  id BIGSERIAL PRIMARY KEY,
  expiry_record_id BIGINT NOT NULL REFERENCES expiry_records(id) ON DELETE CASCADE,
  order_reference TEXT NOT NULL,
  voucher_code TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  event_type TEXT NOT NULL,
  reminder_offset_minutes INTEGER NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  custom_scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','PROCESSING','SENT','FAILED','CANCELLED','SKIPPED','MISSED')),
  event_key TEXT NOT NULL UNIQUE,
  message TEXT,
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expiry_events_due ON expiry_events(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_expiry_events_record ON expiry_events(expiry_record_id, scheduled_for);

CREATE TABLE IF NOT EXISTS expiry_audit_log (
  id BIGSERIAL PRIMARY KEY,
  expiry_record_id BIGINT REFERENCES expiry_records(id) ON DELETE SET NULL,
  event_id BIGINT REFERENCES expiry_events(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expiry_audit_record ON expiry_audit_log(expiry_record_id, created_at DESC);
