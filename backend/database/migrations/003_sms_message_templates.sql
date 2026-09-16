CREATE TABLE IF NOT EXISTS sms_message_templates (
  message_type TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO sms_message_templates (message_type, template, updated_by)
VALUES (
  'PURCHASE_CONFIRMATION',
  'SUPA LAN payment confirmed. Voucher: {{voucher}}. Package: {{package}}{{duration}}. Connect to SUPA LAN and enter your voucher.',
  'system'
)
ON CONFLICT (message_type) DO NOTHING;
