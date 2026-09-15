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
