ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS order_reference TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS voucher_code TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS package_name TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS package_price INTEGER;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS parent_sms_id BIGINT REFERENCES sms_messages(id);
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS provider_response_code TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS provider_response_description TEXT;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sms_messages_attention ON sms_messages(status, message_type, parent_sms_id);
UPDATE sms_messages SET failed_at = created_at WHERE status = 'FAILED' AND failed_at IS NULL;
UPDATE sms_messages SET attempt_number = 1 WHERE attempt_number IS NULL;

ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_status_check;
ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_status_check CHECK (status IN ('QUEUED','SENDING','SENT','FAILED','UNKNOWN'));

ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_attempt_number_check;
ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_attempt_number_check CHECK (attempt_number > 0);
