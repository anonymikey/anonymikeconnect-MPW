ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS event_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sms_messages_event_key ON sms_messages(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS sms_automation_settings (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sms_automation_settings (key, enabled)
VALUES ('master', FALSE)
ON CONFLICT (key) DO NOTHING;
