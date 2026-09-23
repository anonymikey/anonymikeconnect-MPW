CREATE TABLE IF NOT EXISTS expiry_message_templates (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL UNIQUE CHECK (event_type IN ('EXPIRY_REMINDER','EXPIRY_FINAL_REMINDER','EXPIRY_EXPIRED')),
  template_text TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO expiry_message_templates (event_type, template_text) VALUES
 ('EXPIRY_REMINDER', 'SUPA LAN: Your {{package}} package expires in {{remaining_time}} at {{expiry_time}}. Renew your package to continue browsing.'),
 ('EXPIRY_FINAL_REMINDER', 'SUPA LAN: Your {{package}} package expires in {{remaining_time}} at {{expiry_time}}. Renew your package to continue browsing.'),
 ('EXPIRY_EXPIRED', 'SUPA LAN: Your {{package}} package has expired. Purchase another package to continue using SUPA LAN.')
ON CONFLICT (event_type) DO NOTHING; 
CREATE INDEX IF NOT EXISTS idx_expiry_events_scheduled_templates ON expiry_events(status, event_type, reminder_offset_minutes); 
